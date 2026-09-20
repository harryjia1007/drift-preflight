// Offline scoring utilities. This file does not implement the Drift engine.
import { openSync, fstatSync, readSync, closeSync, constants } from 'node:fs';

export const STATUSES = Object.freeze(['PASS_SCOPED', 'FAIL', 'REVIEW', 'INCONCLUSIVE', 'UNSUPPORTED']);
const CLASSIFICATIONS = new Set(['CONTRACT_CHANGE', 'SEMANTIC_CHANGE', 'BEHAVIOR_REGRESSION', 'INSUFFICIENT_EVIDENCE', 'ENVIRONMENT_DIFFERENCE']);
const MAX_BYTES = 1024 * 1024;
const MAX_DEPTH = 64;
const DANGEROUS = new Set(['__proto__', 'constructor', 'prototype']);
const MAX_NUMERIC_TOKEN = 4096;
const MAX_NUMERIC_EXPONENT = 4096;

// Preserve decimal distinctions in supplied JSON: the normalized decimal
// spelling must survive Number conversion and shortest-decimal serialization.
// This permits 0.1 and equivalent spellings such as 1.0/1e0; it does not claim
// exact binary representation of decimal fractions or arbitrary precision.
// The domain separately rejects unsafe integers. Explicit numeric tokens and
// exponents are bounded even for zero, where Number would discard the exponent.
function decimalKey(token) {
  const match = /^(-?)(0|[1-9][0-9]*)(?:\.([0-9]+))?(?:[eE]([+-]?[0-9]+))?$/u.exec(token);
  if (!match) throw new Error('Invalid JSON numeric token');
  const fraction = match[3] ?? '';
  const exponent = Number(match[4] ?? '0');
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > MAX_NUMERIC_EXPONENT) throw new Error('JSON numeric exponent limit exceeded');
  const digits = (match[2] + fraction).replace(/^0+/u, '');
  if (!digits) return '0';
  const coefficient = digits.replace(/0+$/u, '');
  const scale = exponent - fraction.length + digits.length - coefficient.length;
  return `${match[1]}${coefficient}e${scale}`;
}

function checkNumericToken(token) {
  const original = decimalKey(token);
  const number = Number(token);
  if (!Number.isFinite(number)) throw new Error('Non-finite JSON number');
  if (original !== decimalKey(String(number))) throw new Error('JSON numeric precision would be lost');
}

export function parseBoundedJson(text, { maxBytes = MAX_BYTES, maxDepth = MAX_DEPTH } = {}) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > MAX_BYTES || !Number.isSafeInteger(maxDepth) || maxDepth < 1 || maxDepth > MAX_DEPTH) throw new Error('Invalid parser limits');
  if (typeof text !== 'string' || Buffer.byteLength(text, 'utf8') > maxBytes) throw new Error('JSON size limit exceeded');
  let depth = 0, quoted = false, escaped = false, start = 0;
  const contexts = [];
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') {
        quoted = false;
        const context = contexts.at(-1);
        if (context?.expectsKey) {
          const key = JSON.parse(text.slice(start, i + 1));
          if (context.keys.has(key)) throw new Error('Duplicate JSON object key');
          context.keys.add(key);
          context.expectsKey = false;
        }
      }
    } else if (char === '"') { quoted = true; start = i; }
    else if (char === '-' || (char >= '0' && char <= '9')) {
      let end = i + 1;
      while (end < text.length && /[0-9eE+.\-]/u.test(text[end])) {
        if (end - i >= MAX_NUMERIC_TOKEN) throw new Error('JSON numeric token length limit exceeded');
        end++;
      }
      checkNumericToken(text.slice(i, end));
      i = end - 1;
    }
    else if (char === '[' || char === '{') {
      if (++depth > maxDepth) throw new Error('JSON depth limit exceeded');
      contexts.push({ object: char === '{', expectsKey: char === '{', keys: new Set() });
    } else if (char === ']' || char === '}') { depth--; contexts.pop(); }
    else if (char === ',' && contexts.at(-1)?.object) contexts.at(-1).expectsKey = true;
  }
  let nodes = 0;
  return JSON.parse(text, (key, value) => {
    if (++nodes > 50000) throw new Error('JSON node limit exceeded');
    if (DANGEROUS.has(key)) throw new Error('Forbidden JSON object key');
    if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('Non-finite JSON number');
    return value;
  });
}

export function readBoundedText(path) {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile()) throw new Error('JSON input must be a regular file');
    if (stat.size > MAX_BYTES) throw new Error('JSON size limit exceeded');
    const buffer = Buffer.alloc(MAX_BYTES + 1);
    let total = 0, count = 0;
    do {
      count = readSync(fd, buffer, total, buffer.length - total, total);
      total += count;
    } while (count > 0 && total < buffer.length);
    if (total > MAX_BYTES) throw new Error('JSON size limit exceeded');
    // Fatal decoding prevents malformed UTF-8 from silently changing the artifact.
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, total));
  } finally {
    closeSync(fd);
  }
}

export function readBoundedJson(path) { return parseBoundedJson(readBoundedText(path)); }

function record(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Invalid ${label}`);
}
function strings(value, label) {
  if (!Array.isArray(value) || value.length > 100 || value.some(x => typeof x !== 'string' || x.length === 0 || x.length > 500) || new Set(value).size !== value.length) throw new Error(`Invalid ${label}`);
}
function assessment(value, label) {
  record(value, label);
  if (!STATUSES.includes(value.status)) throw new Error(`Invalid ${label} status`);
  strings(value.classifications, `${label} classifications`);
  if (value.classifications.some(x => !CLASSIFICATIONS.has(x))) throw new Error(`Unknown ${label} classification`);
  strings(value.contractChangeCodes, `${label} contractChangeCodes`);
}
const equalSets = (a, b) => a.length === b.length && a.every(item => b.includes(item));

export function score(cases, observations) {
  if (!Array.isArray(cases) || cases.length < 1 || cases.length > 1000) throw new Error('Invalid case count');
  const byId = new Map();
  for (const item of cases) {
    record(item, 'case');
    if (typeof item.id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(item.id) || typeof item.category !== 'string') throw new Error('Invalid case identity');
    if (byId.has(item.id)) throw new Error('Duplicate case id');
    assessment(item.expected, 'expected');
    if (![true, false, null].includes(item.expected.regressionTruth)) throw new Error('Invalid regression truth');
    byId.set(item.id, item);
  }
  if (observations !== null && (!Array.isArray(observations) || observations.length > cases.length)) throw new Error('Invalid observation count');
  const observed = observations ?? [];
  const result = {
    execution: observed.length === 0 ? 'NOT_RUN' : observed.length === cases.length ? 'COMPLETE' : 'PARTIAL',
    observationProvenance: 'USER-REPORTED', evidenceValidation: 'NOT_PERFORMED',
    confusionScope: 'BEHAVIOR_REGRESSION_CLAIM_ONLY',
    corpusSize: cases.length, evaluated: observed.length, notRun: cases.length - observed.length,
    confusion: null, statusCounts: null, exactStatusMatches: null,
    exactClassificationMatches: null, exactContractMatches: null,
    falseFailureAlerts: null, falsePassClaims: null, mismatches: [],
  };
  if (observed.length === 0) return result;
  result.confusion = { truePositive: 0, falsePositive: 0, trueNegative: 0, falseNegative: 0, abstainedPositive: 0, abstainedNegative: 0, unscorable: 0, unsupportedRegressionClaim: 0 };
  result.statusCounts = Object.fromEntries(STATUSES.map(status => [status, 0]));
  result.exactStatusMatches = result.exactClassificationMatches = result.exactContractMatches = 0;
  result.falseFailureAlerts = result.falsePassClaims = 0;
  const seen = new Set();
  for (const observation of observed) {
    assessment(observation, 'observation');
    if (!byId.has(observation.caseId)) throw new Error('Unknown observation case id');
    if (seen.has(observation.caseId)) throw new Error('Duplicate observation case id');
    seen.add(observation.caseId);
    strings(observation.evidence, 'evidence');
    const claimsRegression = observation.classifications.includes('BEHAVIOR_REGRESSION');
    if (claimsRegression && observation.evidence.length === 0) throw new Error('Regression claim requires evidence');
    if (claimsRegression && observation.status !== 'FAIL') throw new Error('Regression claim requires FAIL status');
    const expected = byId.get(observation.caseId).expected;
    const statusMatches = expected.status === observation.status;
    const classificationMatches = equalSets(expected.classifications, observation.classifications);
    const contractMatches = equalSets(expected.contractChangeCodes, observation.contractChangeCodes);
    result.exactStatusMatches += Number(statusMatches);
    result.exactClassificationMatches += Number(classificationMatches);
    result.exactContractMatches += Number(contractMatches);
    result.statusCounts[observation.status]++;
    if (observation.status === 'FAIL' && expected.status !== 'FAIL') result.falseFailureAlerts++;
    if (observation.status === 'PASS_SCOPED' && expected.status !== 'PASS_SCOPED') result.falsePassClaims++;
    if (!statusMatches || !classificationMatches || !contractMatches) result.mismatches.push({ caseId: observation.caseId, statusMatches, classificationMatches, contractMatches });
    const matrix = result.confusion;
    if (expected.regressionTruth === null) {
      matrix.unscorable++;
      if (claimsRegression) matrix.unsupportedRegressionClaim++;
    } else if (claimsRegression) {
      matrix[expected.regressionTruth ? 'truePositive' : 'falsePositive']++;
    } else if (['REVIEW', 'INCONCLUSIVE', 'UNSUPPORTED'].includes(observation.status)) {
      matrix[expected.regressionTruth ? 'abstainedPositive' : 'abstainedNegative']++;
    } else {
      matrix[expected.regressionTruth ? 'falseNegative' : 'trueNegative']++;
    }
  }
  result.mismatches.sort((a, b) => a.caseId.localeCompare(b.caseId, 'en'));
  return result;
}
