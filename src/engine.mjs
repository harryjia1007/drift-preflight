import { createHash } from 'node:crypto';
import { parseBoundedJson } from './scoring.mjs';
import { validateBundle, compareControls, validateJsonData, isSupportedPointer } from './domain.mjs';
import { diffTools } from './contract.mjs';

export const ENGINE_VERSION = '0.1.1';
const own = (object, key) => Object.hasOwn(object, key);
const sortedUnique = values => [...new Set(values)].sort();
const hash = text => createHash('sha256').update(text).digest('hex');
export function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value !== null && typeof value === 'object') return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  return JSON.stringify(value);
}

export class BundleInputError extends Error {
  constructor(diagnostics) { super('Invalid bundle; see structured diagnostics'); this.name = 'BundleInputError'; this.diagnostics = diagnostics; }
}

// Only RFC 6901 string pointers are supported. No URL, filesystem or expression resolution.
export function resolvePointer(value, pointer, internalEvidence = false) {
  if (internalEvidence ? typeof pointer !== 'string' || (pointer !== '' && !pointer.startsWith('/')) || /~(?:[^01]|$)/.test(pointer) : !isSupportedPointer(pointer)) return { exists: false };
  if (pointer === '') return { exists: true, value };
  const parts = pointer.slice(1).split('/').map(p => p.replace(/~1/g, '/').replace(/~0/g, '~'));
  if (parts.length > (internalEvidence ? 128 : 32) || parts.some(p => ['__proto__', 'constructor', 'prototype'].includes(p))) return { exists: false };
  let current = value;
  for (const part of parts) {
    if (current === null || typeof current !== 'object' || !own(current, part)) return { exists: false };
    if (Array.isArray(current) && (!/^(0|[1-9][0-9]*)$/.test(part) || Number(part) >= current.length)) return { exists: false };
    current = current[part];
  }
  return { exists: true, value: current };
}

// Bounds apply to assertion evaluation and report evidence, independently of
// the contract module's budget. Cached reads still consume one operation.
// Exceeding either limit aborts with structured diagnostics, never a partial
// PASS. Canonical-byte accounting includes nested serialized values, limiting
// the memory amplification of deep objects as well as repeated comparisons.
const MAX_BEHAVIOR_OPERATIONS = 200000;
const MAX_CANONICAL_BYTES = 8 * 1024 * 1024;
function createEvaluation(bundle) {
  let operations = 0, canonicalBytes = 0;
  const objectText = new WeakMap(), primitiveText = new Map();
  const objectSummary = new WeakMap(), primitiveSummary = new Map();
  const observationIndexes = new WeakMap(), checks = new Map();
  const spend = () => {
    if (++operations > MAX_BEHAVIOR_OPERATIONS) throw new BundleInputError([{ path: '/assertions', reason: 'BEHAVIOR_WORK_LIMIT', kind: 'operations', limit: MAX_BEHAVIOR_OPERATIONS }]);
  };
  const cacheFor = (value, objects, primitives) => value !== null && typeof value === 'object' ? objects : primitives;
  const serialize = value => {
    spend();
    const cache = cacheFor(value, objectText, primitiveText);
    if (cache.has(value)) return cache.get(value);
    const serialized = Array.isArray(value) ? '[' + value.map(serialize).join(',') + ']'
      : value !== null && typeof value === 'object' ? '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + serialize(value[key])).join(',') + '}'
        : JSON.stringify(value);
    canonicalBytes += Buffer.byteLength(serialized, 'utf8');
    if (canonicalBytes > MAX_CANONICAL_BYTES) throw new BundleInputError([{ path: '/assertions', reason: 'BEHAVIOR_WORK_LIMIT', kind: 'canonicalBytes', limit: MAX_CANONICAL_BYTES }]);
    cache.set(value, serialized);
    return serialized;
  };
  const evidence = (pointer, resolved) => {
    spend();
    if (!resolved.exists) return { pointer, exists: false, preview: null, sha256: null, truncated: false };
    const cache = cacheFor(resolved.value, objectSummary, primitiveSummary);
    if (!cache.has(resolved.value)) {
      const serialized = serialize(resolved.value);
      cache.set(resolved.value, { preview: serialized.slice(0, 1000), sha256: hash(serialized), truncated: serialized.length > 1000 });
    }
    return { pointer, exists: true, ...cache.get(resolved.value) };
  };
  const checkAssertion = (run, assertion, role) => {
    spend();
    // Assertion IDs identify protected expectations, not computation identity.
    // Identical checks retain their separate outcomes but share immutable work.
    const key = JSON.stringify([role, assertion.workflowId, assertion.observationId, assertion.type, assertion.path, assertion.type === 'exists' ? null : serialize(assertion.value)]);
    if (checks.has(key)) return checks.get(key);
    if (!observationIndexes.has(run)) observationIndexes.set(run, new Map((run.observations ?? []).map((observation, index) => [observation.observationId, { observation, index }])));
    const match = observationIndexes.get(run).get(assertion.observationId);
    let result;
    if (!match || match.observation.workflowId !== assertion.workflowId) {
      const pointer = `/${role}/observations`;
      result = { outcome: 'MISSING', evidence: { ...evidence(pointer, resolvePointer(bundle, pointer, true)), missingSelector: { observationId: assertion.observationId, workflowId: assertion.workflowId } } };
    } else if (!own(match.observation, 'result')) {
      result = { outcome: 'MISSING', evidence: evidence(`/${role}/observations/${match.index}/result`, { exists: false }) };
    } else {
      const resolved = resolvePointer(match.observation.result, assertion.path);
      let passed = false;
      if (assertion.type === 'exists') passed = resolved.exists;
      else if (resolved.exists && assertion.type === 'equals') passed = serialize(resolved.value) === serialize(assertion.value);
      else if (resolved.exists && assertion.type === 'includes' && Array.isArray(resolved.value)) {
        // The domain permits scalar needles only. Composite elements cannot
        // equal a scalar and must not trigger recursive serialization.
        for (const value of resolved.value) {
          spend();
          if (value === assertion.value) { passed = true; break; }
        }
      } else if (resolved.exists && assertion.type === 'minCount') passed = Array.isArray(resolved.value) && resolved.value.length >= assertion.value;
      result = { outcome: passed ? 'PASS' : 'FAIL', evidence: evidence(`/${role}/observations/${match.index}/result${assertion.path}`, resolved) };
    }
    checks.set(key, result);
    return result;
  };
  return { evidence, checkAssertion };
}

function runAnalysis(bundle, originalText) {
  const validation = validateBundle(bundle);
  if (validation.invalid.length) throw new BundleInputError(validation.invalid);
  const { evidence, checkAssertion } = createEvaluation(bundle);
  const workflows = Array.isArray(bundle?.workflows) ? bundle.workflows.filter(w => w && typeof w.id === 'string') : [];
  const assertions = Array.isArray(bundle?.assertions) ? bundle.assertions.filter(a => a && typeof a.workflowId === 'string') : [];
  const assertedWorkflowIds = sortedUnique(assertions.map(a => a.workflowId));
  const unassertedWorkflowIds = workflows.map(w => w.id).filter(id => !assertedWorkflowIds.includes(id)).sort();
  const result = {
    reportVersion: '0.1.1', engineVersion: ENGINE_VERSION, status: 'REVIEW',
    classifications: [], contractChangeCodes: [], affectedWorkflowIds: [],
    scope: { kind: 'SUPPLIED_RECORDINGS', liveExecution: false, sourceAuthenticated: false, workflowIds: assertedWorkflowIds, unassertedWorkflowIds, requestedWorkflowIds: workflows.map(w => w.id).sort(), assertionCount: assertions.length },
    integrity: { bundleSha256: hash(originalText), assertionsSha256: hash(canonical(assertions)) },
    comparison: { comparable: false, controlled: [], uncontrolled: [], missingObservation: false },
    assertionOutcomes: { baseline: {}, candidate: {} }, findings: [], diagnostics: [],
  };
  const finish = () => {
    if (Buffer.byteLength(JSON.stringify(result), 'utf8') > 1048576) throw new BundleInputError([{ path: '', reason: 'REPORT_SIZE_LIMIT' }]);
    return result;
  };
  if (validation.unsupported.length) {
    result.status = 'UNSUPPORTED'; result.diagnostics = validation.unsupported;
    return finish();
  }
  const comparison = compareControls(bundle);
  result.comparison = { ...comparison, uncontrolled: comparison.uncontrolled.map(item => {
    const summary = value => { const { preview, sha256, truncated } = evidence('', { exists: true, value }); return { preview, sha256, truncated }; };
    return { path: item.path, reason: item.reason, baseline: summary(item.baseline), candidate: summary(item.candidate) };
  }) };
  const contracts = diffTools(bundle.baseline.toolVersions, bundle.candidate.toolVersions, bundle.workflows);
  const unsupported = [...validation.unsupported, ...contracts.unsupported];
  if (unsupported.length) {
    result.status = 'UNSUPPORTED'; result.diagnostics = unsupported;
    return finish();
  }
  const workflowIds = bundle.workflows.map(w => w.id);
  const addFinding = (type, details) => {
    if (result.findings.length >= 1000) throw new BundleInputError([{ path: '', reason: 'FINDING_LIMIT' }]);
    result.findings.push({
      id: `finding-${String(result.findings.length + 1).padStart(4, '0')}`,
      issueId: `finding-${String(result.findings.length + 1).padStart(4, '0')}`,
      type, severity: 'medium', confidence: { level: 'scoped', rationale: 'Computed from supplied artifacts; capture origin and live service behavior are not authenticated.' },
      affectedWorkflowIds: [], assertionId: null,
      baselineEvidence: evidence(null, { exists: false }), candidateEvidence: evidence(null, { exists: false }),
      controlledVariables: { reference: '/comparison/controlled' }, uncontrolledVariables: { reference: '/comparison/uncontrolled' },
      requiresHumanReview: true,
      ...details,
    });
  };
  for (const change of contracts.changes) {
    const type = change.code === 'DESCRIPTION_CHANGED' ? 'SEMANTIC_CHANGE' : 'CONTRACT_CHANGE';
    const beforeIndex = bundle.baseline.toolVersions.findIndex(t => t.toolId === change.toolId);
    const afterIndex = bundle.candidate.toolVersions.findIndex(t => t.toolId === change.toolId);
    const beforePointer = beforeIndex < 0 ? '/baseline/toolVersions' : `/baseline/toolVersions/${beforeIndex}${change.path}`;
    const afterPointer = afterIndex < 0 ? '/candidate/toolVersions' : `/candidate/toolVersions/${afterIndex}${change.path}`;
    addFinding(type, {
      changeCode: change.code, affectedWorkflowIds: change.affectedWorkflowIds,
      whatChanged: `${change.code} in ${change.toolId} at ${change.path || '/'}.`,
      whyItMatters: type === 'SEMANTIC_CHANGE' ? 'Description change is a hypothesis about meaning, not proof of changed behavior.' : 'A declared tool contract changed; business impact requires a protected workflow assertion.',
      baselineEvidence: { ...evidence(beforePointer, resolvePointer(bundle, beforePointer, true)), ...(beforeIndex < 0 ? { missingSelector: { toolId: change.toolId } } : {}) },
      candidateEvidence: { ...evidence(afterPointer, resolvePointer(bundle, afterPointer, true)), ...(afterIndex < 0 ? { missingSelector: { toolId: change.toolId } } : {}) },
      recommendedNextStep: 'Review affected workflows and exercise unchanged assertions with controlled observations.',
    });
    if (type === 'CONTRACT_CHANGE') result.contractChangeCodes.push(change.code);
  }
  for (const assertion of bundle.assertions) {
    result.assertionOutcomes.baseline[assertion.id] = checkAssertion(bundle.baseline, assertion, 'baseline').outcome;
    result.assertionOutcomes.candidate[assertion.id] = checkAssertion(bundle.candidate, assertion, 'candidate').outcome;
  }
  if (!comparison.comparable) {
    result.status = 'INCONCLUSIVE';
    const differences = comparison.uncontrolled.filter(item => item.reason === 'DIFFERENT');
    const missing = comparison.uncontrolled.filter(item => item.reason !== 'DIFFERENT');
    for (const [type, variables] of [['ENVIRONMENT_DIFFERENCE', differences], ['INSUFFICIENT_EVIDENCE', missing]]) {
      if (!variables.length && !(type === 'INSUFFICIENT_EVIDENCE' && comparison.missingObservation)) continue;
      const evidenceSection = variables.some(item => item.path.startsWith('/observations/')) || comparison.missingObservation ? 'observations' : 'fixture';
      addFinding(type, {
        affectedWorkflowIds: workflowIds,
        whatChanged: type === 'ENVIRONMENT_DIFFERENCE' ? 'Required comparison controls differ between the supplied runs.' : 'Required observations or comparison controls are missing.',
        whyItMatters: 'The supplied runs do not support a controlled attribution to the integration update.',
        baselineEvidence: evidence(`/baseline/${evidenceSection}`, resolvePointer(bundle, `/baseline/${evidenceSection}`)),
        candidateEvidence: evidence(`/candidate/${evidenceSection}`, resolvePointer(bundle, `/candidate/${evidenceSection}`)),
        recommendedNextStep: 'Capture complete runs under the same declared controls, then evaluate the same assertions.',
      });
    }
  } else if (bundle.assertions.length === 0) {
    result.status = 'REVIEW';
    addFinding('INSUFFICIENT_EVIDENCE', {
      affectedWorkflowIds: contracts.changes.length ? sortedUnique(contracts.changes.flatMap(c => c.affectedWorkflowIds)) : workflowIds,
      whatChanged: 'No protected behavior assertion was supplied.',
      whyItMatters: 'Output or contract differences alone cannot establish a business regression or a scoped pass.',
      baselineEvidence: evidence('/baseline/observations', resolvePointer(bundle, '/baseline/observations')),
      candidateEvidence: evidence('/candidate/observations', resolvePointer(bundle, '/candidate/observations')),
      recommendedNextStep: 'Confirm the business expectation with the workflow owner and add a protected assertion.',
    });
  } else {
    const failures = bundle.assertions.filter(a => result.assertionOutcomes.candidate[a.id] !== 'PASS');
    result.status = failures.length ? 'FAIL' : 'PASS_SCOPED';
    for (const assertion of failures) {
      const before = checkAssertion(bundle.baseline, assertion, 'baseline');
      const after = checkAssertion(bundle.candidate, assertion, 'candidate');
      const isRegression = before.outcome === 'PASS';
      const workflowIndex = bundle.workflows.findIndex(w => w.id === assertion.workflowId);
      const criticality = bundle.workflows[workflowIndex].criticality;
      const assertionIndex = bundle.assertions.indexOf(assertion);
      const definitionPointer = `/assertions/${assertionIndex}`;
      const details = {
        issueId: `assertion-${assertionIndex + 1}`,
        severity: ['critical', 'high'].includes(criticality) ? 'high' : 'medium',
        affectedWorkflowIds: [assertion.workflowId], assertionId: assertion.id,
        assertionContext: {
          definitionPointer, type: assertion.type, resultPath: assertion.path, observationId: assertion.observationId,
          expectedEvidence: evidence(`${definitionPointer}/value`, resolvePointer(bundle, `${definitionPointer}/value`, true)),
        },
        workflowEvidence: evidence(`/workflows/${workflowIndex}`, { exists: true, value: bundle.workflows[workflowIndex] }),
        whatChanged: `The supplied candidate violates assertion ${assertion.id}. Baseline outcome: ${before.outcome}.`,
        whyItMatters: isRegression ? 'The same protected assertion passed on the supplied baseline under matching declared fixture controls.' : 'The baseline already fails; this is not evidence of a newly introduced regression.',
        baselineEvidence: before.evidence, candidateEvidence: after.evidence,
        recommendedNextStep: isRegression ? 'Investigate the scoped difference, propose a minimal repair, and rerun the unchanged assertion.' : 'Repair or replace the invalid baseline with justified evidence before attributing this failure to an update.',
      };
      if (isRegression) addFinding('SEMANTIC_CHANGE', details);
      addFinding(isRegression ? 'BEHAVIOR_REGRESSION' : 'INSUFFICIENT_EVIDENCE', details);
    }
  }
  if (result.status === 'PASS_SCOPED' && unassertedWorkflowIds.length) {
    result.status = 'REVIEW';
    addFinding('INSUFFICIENT_EVIDENCE', {
      affectedWorkflowIds: unassertedWorkflowIds,
      whatChanged: 'Requested workflows have no protected assertions.',
      whyItMatters: 'A passing assertion in another workflow does not establish coverage for these workflows.',
      baselineEvidence: evidence('/assertions', resolvePointer(bundle, '/assertions', true)),
      candidateEvidence: evidence('/assertions', resolvePointer(bundle, '/assertions', true)),
      recommendedNextStep: 'Confirm and add assertions for the uncovered workflows or explicitly narrow the requested bundle scope.',
    });
  }
  result.contractChangeCodes = sortedUnique(result.contractChangeCodes);
  result.classifications = sortedUnique(result.findings.map(f => f.type));
  result.affectedWorkflowIds = sortedUnique(result.findings.flatMap(f => f.affectedWorkflowIds));
  return finish();
}

export function analyzeText(text) { return runAnalysis(parseBoundedJson(text), text); }
// Descriptor validation happens before serialization; input cannot activate a getter/toJSON.
export function analyzeBundle(bundle) {
  const boundary = validateJsonData(bundle);
  if (boundary) throw new BundleInputError([{ path: boundary.path, reason: boundary.reason }]);
  return analyzeText(JSON.stringify(bundle));
}
