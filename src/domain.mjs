// The v0.1 domain accepts bounded JSON data only. No I/O, evaluation, or network.
const FIXTURE_DIMENSIONS = Object.freeze(['input', 'environment', 'permissions', 'seedData', 'clock', 'locale', 'timezone']);
const ENVIRONMENT_FIELDS = Object.freeze(['kind', 'region', 'model', 'promptVersion', 'runtimeProfile']);
const ASSERTION_TYPES = new Set(['equals', 'includes', 'minCount', 'exists']);
const DANGEROUS = new Set(['__proto__', 'constructor', 'prototype']);
export const POINTER_LIMITS = Object.freeze({ maxCharacters: 256, maxSegments: 32 });
const own = (value, key) => value !== null && typeof value === 'object' && Object.hasOwn(value, key);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const escapePointer = value => value.replaceAll('~', '~0').replaceAll('/', '~1');
export function isSupportedPointer(value) {
  if (typeof value !== 'string' || value.length > POINTER_LIMITS.maxCharacters || (value !== '' && !value.startsWith('/')) || /~(?:[^01]|$)/u.test(value)) return false;
  const segments = value === '' ? [] : value.slice(1).split('/').map(part => part.replaceAll('~1', '/').replaceAll('~0', '~'));
  return segments.length <= POINTER_LIMITS.maxSegments && segments.every(segment => !DANGEROUS.has(segment));
}
const recorded = value => value !== undefined && value !== null && (typeof value !== 'string' || value.trim().length > 0);

function jsonBoundary(root) {
  let nodes = 0, bytes = 0;
  const active = new WeakSet();
  const walk = (value, path, depth) => {
    if (++nodes > 50000 || depth > 64) return { kind: 'unsupported', path, reason: 'JSON node or depth limit exceeded' };
    if (typeof value === 'string') bytes += Buffer.byteLength(value, 'utf8') + 2;
    else if (value === null || typeof value === 'boolean') bytes += 5;
    else if (typeof value === 'number') {
      if (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value))) return { kind: 'invalid', path, reason: 'Numbers must be finite; integer values must be safe JavaScript integers' };
      bytes += String(value).length;
    } else if (typeof value !== 'object') return { kind: 'invalid', path, reason: 'Only JSON data values are allowed' };
    if (bytes > 1048576) return { kind: 'unsupported', path, reason: 'JSON data size limit exceeded' };
    if (value === null || typeof value !== 'object') return null;
    if (active.has(value)) return { kind: 'invalid', path, reason: 'Cyclic objects are not JSON data' };
    const array = Array.isArray(value), proto = Object.getPrototypeOf(value);
    if (array ? proto !== Array.prototype : proto !== Object.prototype && proto !== null) return { kind: 'invalid', path, reason: 'Only plain JSON objects and arrays are allowed' };
    if (array && value.length > 10000) return { kind: 'unsupported', path, reason: 'JSON array length limit exceeded' };
    active.add(value);
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    if (array && keys.length !== value.length + 1) return { kind: 'invalid', path, reason: 'Sparse arrays and non-index array properties are not JSON data' };
    for (const key of keys) {
      if (array && key === 'length') continue;
      if (typeof key !== 'string') return { kind: 'invalid', path, reason: 'Symbol properties are not JSON data' };
      const childPath = `${path}/${escapePointer(key)}`, descriptor = descriptors[key];
      if (DANGEROUS.has(key)) return { kind: 'unsupported', path: childPath, reason: 'Forbidden JSON object key' };
      if (!descriptor.enumerable || !own(descriptor, 'value')) return { kind: 'invalid', path: childPath, reason: 'Only enumerable data properties are allowed; accessors are rejected' };
      if (array && !/^(0|[1-9][0-9]*)$/u.test(key)) return { kind: 'invalid', path: childPath, reason: 'Array properties must be numeric indices' };
      bytes += Buffer.byteLength(key, 'utf8') + 4;
      const issue = walk(descriptor.value, childPath, depth + 1);
      if (issue) return issue;
    }
    active.delete(value);
    return null;
  };
  return walk(root, '', 0);
}
export { jsonBoundary as validateJsonData };

export function validateBundle(bundle) {
  const result = { unsupported: [], invalid: [] };
  const boundary = jsonBoundary(bundle);
  if (boundary) {
    result[boundary.kind].push({ path: boundary.path, reason: boundary.reason });
    return result;
  }
  const report = (kind, path, reason) => { if (result[kind].length < 100) result[kind].push({ path, reason }); };
  const invalid = (path, reason) => report('invalid', path, reason);
  const unsupported = (path, reason) => report('unsupported', path, reason);
  const record = (value, path, allowed) => {
    if (!object(value)) { invalid(path, 'Expected an object'); return false; }
    if (allowed) for (const key of Object.keys(value)) if (!allowed.includes(key)) unsupported(`${path}/${escapePointer(key)}`, 'Unknown field is outside the v0.1 domain profile');
    return true;
  };
  const text = (value, path, { optional = false, nullable = false, max = 500, empty = false } = {}) => {
    if ((optional && value === undefined) || (nullable && value === null)) return true;
    if (typeof value !== 'string' || value.length > max || (!empty && value.trim().length === 0)) { invalid(path, `Expected ${empty ? 'a' : 'a nonempty'} string of at most ${max} characters`); return false; }
    return true;
  };
  const list = (value, path, { optional = false, max = 1000 } = {}) => {
    if (optional && value === undefined) return true;
    if (!Array.isArray(value)) { invalid(path, 'Expected an array'); return false; }
    if (value.length > max) { unsupported(path, `Collection exceeds ${max} entries`); return false; }
    return true;
  };
  const strings = (value, path, { unique = true } = {}) => {
    if (!list(value, path)) return false;
    value.forEach((item, index) => text(item, `${path}/${index}`));
    if (unique && new Set(value).size !== value.length) invalid(path, 'Duplicate values are not allowed');
    return true;
  };
  const unique = (entries, key, path) => {
    const found = new Set();
    for (const [index, entry] of entries.entries()) {
      if (!object(entry) || typeof entry[key] !== 'string') continue;
      if (found.has(entry[key])) invalid(`${path}/${index}/${key}`, 'Duplicate identifier');
      found.add(entry[key]);
    }
    return found;
  };
  if (!record(bundle, '', ['bundleVersion', 'integration', 'workflows', 'assertions', 'baseline', 'candidate', 'comparisonPolicy'])) return result;
  if (text(bundle.bundleVersion, '/bundleVersion') && bundle.bundleVersion !== '0.1.0') unsupported('/bundleVersion', 'Only bundleVersion 0.1.0 is supported');
  if (record(bundle.integration, '/integration', ['id', 'name'])) {
    text(bundle.integration.id, '/integration/id'); text(bundle.integration.name, '/integration/name');
  }
  const workflows = list(bundle.workflows, '/workflows') ? bundle.workflows : [];
  const assertions = list(bundle.assertions, '/assertions') ? bundle.assertions : [];
  const workflowIds = unique(workflows, 'id', '/workflows');
  unique(assertions, 'id', '/assertions');
  for (const [index, workflow] of workflows.entries()) {
    const path = `/workflows/${index}`;
    if (!record(workflow, path, ['id', 'description', 'dependsOnTools', 'businessExpectations', 'criticality'])) continue;
    text(workflow.id, `${path}/id`);
    text(workflow.description, `${path}/description`, { optional: true, max: 8000, empty: true });
    strings(workflow.dependsOnTools, `${path}/dependsOnTools`);
    strings(workflow.businessExpectations, `${path}/businessExpectations`);
    if (!['low', 'medium', 'high', 'critical'].includes(workflow.criticality)) invalid(`${path}/criticality`, 'Expected low, medium, high, or critical');
  }
  const inventory = new Set();
  const observations = [];
  for (const side of ['baseline', 'candidate']) {
    const run = bundle[side], path = `/${side}`;
    if (!record(run, path, ['toolVersions', 'fixture', 'observations'])) continue;
    if (list(run.toolVersions, `${path}/toolVersions`)) {
      unique(run.toolVersions, 'toolId', `${path}/toolVersions`);
      for (const [index, tool] of run.toolVersions.entries()) {
        const p = `${path}/toolVersions/${index}`;
        if (!record(tool, p, ['toolId', 'name', 'version', 'source', 'capturedAt', 'description', 'inputSchema', 'outputSchema'])) continue;
        if (text(tool.toolId, `${p}/toolId`)) inventory.add(tool.toolId);
        text(tool.name, `${p}/name`);
        for (const field of ['version', 'source', 'capturedAt']) text(tool[field], `${p}/${field}`, { optional: true, nullable: true, empty: true });
        text(tool.description, `${p}/description`, { optional: true, max: 8000, empty: true });
        // The contract module validates the supported schema vocabulary.
        for (const field of ['inputSchema', 'outputSchema']) if (!(object(tool[field]) || typeof tool[field] === 'boolean')) invalid(`${p}/${field}`, 'Expected a JSON Schema object or boolean');
      }
    }
    if (run.fixture !== undefined && run.fixture !== null && record(run.fixture, `${path}/fixture`, ['fixtureId', ...FIXTURE_DIMENSIONS])) {
      const fixture = run.fixture;
      text(fixture.fixtureId, `${path}/fixture/fixtureId`, { optional: true, nullable: true, empty: true });
      if (recorded(fixture.environment) && record(fixture.environment, `${path}/fixture/environment`)) {
        for (const field of ENVIRONMENT_FIELDS) text(fixture.environment[field], `${path}/fixture/environment/${field}`, { optional: true, nullable: true, empty: true });
      }
      if (recorded(fixture.permissions)) strings(fixture.permissions, `${path}/fixture/permissions`, { unique: false });
      for (const field of ['clock', 'locale', 'timezone']) text(fixture[field], `${path}/fixture/${field}`, { optional: true, nullable: true, empty: true });
    }
    if (list(run.observations, `${path}/observations`, { optional: true }) && run.observations) {
      unique(run.observations, 'observationId', `${path}/observations`);
      for (const [index, observation] of run.observations.entries()) {
        const p = `${path}/observations/${index}`;
        if (!record(observation, p, ['observationId', 'workflowId', 'toolId', 'httpStatus', 'result', 'sideEffects'])) continue;
        for (const field of ['observationId', 'workflowId', 'toolId']) text(observation[field], `${p}/${field}`);
        if (own(observation, 'httpStatus') && (!Number.isInteger(observation.httpStatus) || observation.httpStatus < 100 || observation.httpStatus > 599)) invalid(`${p}/httpStatus`, 'Expected an HTTP status integer from 100 to 599');
        if (own(observation, 'sideEffects')) list(observation.sideEffects, `${p}/sideEffects`);
        observations.push({ value: observation, path: p });
      }
    }
  }
  for (const [index, workflow] of workflows.entries()) if (Array.isArray(workflow?.dependsOnTools)) {
    for (const [dependencyIndex, toolId] of workflow.dependsOnTools.entries()) if (!inventory.has(toolId)) invalid(`/workflows/${index}/dependsOnTools/${dependencyIndex}`, 'Dependency is absent from both tool inventories');
  }
  const workflowMap = new Map(workflows.filter(object).map(workflow => [workflow.id, workflow]));
  for (const { value: observation, path } of observations) {
    if (!workflowIds.has(observation.workflowId)) invalid(`${path}/workflowId`, 'Observation references an unknown workflow');
    if (!inventory.has(observation.toolId)) invalid(`${path}/toolId`, 'Observation references a tool absent from both inventories');
    const workflow = workflowMap.get(observation.workflowId);
    if (Array.isArray(workflow?.dependsOnTools) && !workflow.dependsOnTools.includes(observation.toolId)) invalid(`${path}/toolId`, 'Observed tool is not a declared workflow dependency');
  }
  for (const [index, assertion] of assertions.entries()) {
    const path = `/assertions/${index}`;
    if (!record(assertion, path, ['id', 'workflowId', 'observationId', 'type', 'path', 'value'])) continue;
    for (const field of ['id', 'workflowId', 'observationId']) text(assertion[field], `${path}/${field}`);
    if (DANGEROUS.has(assertion.id)) invalid(`${path}/id`, 'Assertion identifier is a reserved outcome-map key');
    if (!workflowIds.has(assertion.workflowId)) invalid(`${path}/workflowId`, 'Assertion references an unknown workflow');
    for (const { value: observation } of observations) if (observation.observationId === assertion.observationId && observation.workflowId !== assertion.workflowId) invalid(`${path}/observationId`, 'Assertion and observation belong to different workflows');
    if (typeof assertion.type !== 'string') invalid(`${path}/type`, 'Expected an assertion type string');
    else if (!ASSERTION_TYPES.has(assertion.type)) unsupported(`${path}/type`, 'Unsupported assertion type');
    if (!isSupportedPointer(assertion.path)) unsupported(`${path}/path`, 'Expected an RFC 6901 JSON Pointer of at most 256 characters and 32 segments, without reserved object-key segments');
    if (assertion.type !== 'exists' && !own(assertion, 'value')) unsupported(`${path}/value`, 'This assertion requires an explicit value');
    if (assertion.type === 'includes' && assertion.value !== null && !['string', 'number', 'boolean'].includes(typeof assertion.value)) unsupported(`${path}/value`, 'includes requires a JSON scalar value');
    if (assertion.type === 'minCount' && (!Number.isSafeInteger(assertion.value) || assertion.value < 0)) unsupported(`${path}/value`, 'minCount requires a nonnegative safe integer');
    if (assertion.type === 'exists' && own(assertion, 'value')) unsupported(`${path}/value`, 'exists does not accept a value operand');
  }
  if (record(bundle.comparisonPolicy, '/comparisonPolicy', ['requiredFixtureDimensions', 'toolVersionsAreTreatment'])) {
    const dimensions = bundle.comparisonPolicy.requiredFixtureDimensions;
    if (strings(dimensions, '/comparisonPolicy/requiredFixtureDimensions') && (dimensions.length !== FIXTURE_DIMENSIONS.length || FIXTURE_DIMENSIONS.some(item => !dimensions.includes(item)))) unsupported('/comparisonPolicy/requiredFixtureDimensions', 'v0.1 requires all seven fixed fixture controls');
    if (bundle.comparisonPolicy.toolVersionsAreTreatment !== true) unsupported('/comparisonPolicy/toolVersionsAreTreatment', 'v0.1 requires tool versions as the intended treatment');
  }
  return result;
}

function equal(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object' || Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) return a.length === b.length && a.every((value, index) => equal(value, b[index]));
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every(key => own(b, key) && equal(a[key], b[key]));
}

export function compareControls(bundle) {
  const validation = validateBundle(bundle);
  if (validation.invalid.length || validation.unsupported.length) return {
    comparable: false, controlled: [], missingObservation: false,
    uncontrolled: [...validation.invalid.map(issue => ({ ...issue, reason: 'INVALID', baseline: null, candidate: null })), ...validation.unsupported.map(issue => ({ ...issue, reason: 'UNSUPPORTED', baseline: null, candidate: null }))],
  };
  const controlled = [], uncontrolled = [];
  const add = (path, reason, baseline, candidate) => uncontrolled.push({ path, reason, baseline: baseline === undefined ? null : baseline, candidate: candidate === undefined ? null : candidate });
  const compare = (path, baseline, candidate, { set = false, data = false } = {}) => {
    // An explicit JSON null is valid input/data; null metadata denotes unknown.
    if (data ? baseline === undefined || candidate === undefined : !recorded(baseline) || !recorded(candidate)) add(path, 'MISSING', baseline, candidate);
    else if (set ? !equal([...new Set(baseline)].sort(), [...new Set(candidate)].sort()) : !equal(baseline, candidate)) add(path, 'DIFFERENT', baseline, candidate);
    else controlled.push(path);
  };
  const baseline = bundle.baseline.fixture ?? {}, candidate = bundle.candidate.fixture ?? {};
  for (const dimension of FIXTURE_DIMENSIONS) {
    const path = `/fixture/${dimension}`;
    if (dimension === 'environment' && object(baseline.environment) && object(candidate.environment)) {
      const fields = [...new Set([...ENVIRONMENT_FIELDS, ...Object.keys(baseline.environment), ...Object.keys(candidate.environment)])].sort();
      for (const field of fields) compare(`${path}/${escapePointer(field)}`, baseline.environment[field], candidate.environment[field]);
    } else compare(path, baseline[dimension], candidate[dimension], { set: dimension === 'permissions', data: dimension === 'input' || dimension === 'seedData' });
  }
  if (!recorded(baseline.fixtureId) || !recorded(candidate.fixtureId)) add('/fixture/fixtureId', 'MISSING', baseline.fixtureId, candidate.fixtureId);
  const baselineTools = new Map(bundle.baseline.toolVersions.map(tool => [tool.toolId, tool]));
  const candidateTools = new Map(bundle.candidate.toolVersions.map(tool => [tool.toolId, tool]));
  for (const toolId of [...new Set([...baselineTools.keys(), ...candidateTools.keys()])].sort()) {
    const old = baselineTools.get(toolId), next = candidateTools.get(toolId);
    // A new/removed tool is contract evidence, not an unknown tool version.
    for (const field of ['version', 'source', 'capturedAt']) if ((old && !recorded(old[field])) || (next && !recorded(next[field]))) add(`/toolVersions/${escapePointer(toolId)}/${field}`, 'MISSING', old?.[field], next?.[field]);
  }
  const oldObservations = new Map((bundle.baseline.observations ?? []).map(observation => [observation.observationId, observation]));
  const newObservations = new Map((bundle.candidate.observations ?? []).map(observation => [observation.observationId, observation]));
  const ids = [...new Set([...oldObservations.keys(), ...newObservations.keys(), ...bundle.assertions.map(assertion => assertion.observationId)])].sort();
  let missingObservation = false;
  for (const id of ids) {
    const old = oldObservations.get(id), next = newObservations.get(id);
    // A version is the declared treatment, not a switch to another tool or
    // workflow. Reused observation labels alone do not establish identity.
    if (old && next) {
      for (const field of ['toolId', 'workflowId']) compare(`/observations/${escapePointer(id)}/${field}`, old[field], next[field]);
    }
    if (!old || !next || !own(old, 'result') || !own(next, 'result')) {
      missingObservation = true;
      add(`/observations/${escapePointer(id)}`, 'MISSING', old ?? null, next ?? null);
    }
    const oldTool = old && baselineTools.get(old.toolId), nextTool = next && candidateTools.get(next.toolId);
    if ((old && !oldTool) || (next && !nextTool)) add(`/observations/${escapePointer(id)}/toolVersion`, 'MISSING', oldTool, nextTool);
    if ((old && !own(old, 'httpStatus')) || (next && !own(next, 'httpStatus'))) add(`/observations/${escapePointer(id)}/httpStatus`, 'MISSING', old?.httpStatus, next?.httpStatus);
    if ([old, next].some(observation => observation && own(observation, 'httpStatus') && (observation.httpStatus < 200 || observation.httpStatus > 299))) add(`/observations/${escapePointer(id)}/httpStatus`, 'UNSUCCESSFUL', old?.httpStatus, next?.httpStatus);
  }
  return { comparable: uncontrolled.length === 0, controlled, uncontrolled, missingObservation };
}
