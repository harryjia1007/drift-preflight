/**
 * Pure, offline structural contract comparison; this is not a JSON Schema
 * validator, compatibility proof, or business-regression verdict.
 *
 * Profile: object schemas, JSON Schema 2020-12 (or omitted $schema); type names
 * and unordered type arrays, properties, required, JSON-valued enum sets,
 * recursive items, boolean additionalProperties, description, and title.
 * Boolean schemas, references, composition, and every other keyword are
 * explicitly unsupported, including when unchanged or in added/removed tools.
 * Title/$schema annotations do not produce changes. Description whitespace is
 * normalized; substantive changes are DESCRIPTION_CHANGED hypotheses only.
 * A missing items constraint is compared with {}. additionalProperties defaults
 * to true. Other comparisons are structural, not logical schema implication.
 *
 * Whole argument tuple: <= 1 MiB serialized JSON, <= 64 object/array depth,
 * <= 50,000 values/keys and <= 200,000 comparison operations; <= 2,048 tools per
 * side and workflows. Reject cycles, accessors, non-JSON values, and dangerous
 * keys before reading schema values. Accept JSON data, not arbitrary JS proxies.
 * No network, file access, dynamic evaluation, process creation, or mutations.
 */

const KEYWORDS = new Set(['$schema', 'type', 'properties', 'required', 'enum', 'items', 'additionalProperties', 'description', 'title']);
const TYPES = new Set(['null', 'boolean', 'object', 'array', 'number', 'integer', 'string']);
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const MAX_BYTES = 1048576;
const MAX_NODES = 50000;
const MAX_DEPTH = 64;
const MAX_OPERATIONS = 200000;
const MAX_COLLECTION = 2048;
const own = (value, key) => Object.hasOwn(value, key);
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const compareText = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const escaped = value => value.replace(/~/g, '~0').replace(/\//g, '~1');
const normalizedDescription = value => (value ?? '').replace(/\s+/gu, ' ').trim();
const snapshot = value => value === undefined ? null : JSON.parse(JSON.stringify(value));

class LimitError extends Error {}

function inspectJson(value) {
  const ancestors = new Set();
  let nodes = 0;
  let characters = 0;
  function visit(current, depth, path) {
    if (++nodes > MAX_NODES) throw new LimitError(`Input node limit exceeded at ${path}`);
    if (typeof current === 'string') {
      characters += current.length;
      if (characters > MAX_BYTES) throw new LimitError(`Input string limit exceeded at ${path}`);
      return;
    }
    if (current === null || typeof current === 'boolean' || (typeof current === 'number' && Number.isFinite(current))) return;
    if (typeof current !== 'object') throw new LimitError(`Non-JSON value at ${path}`);
    if (depth > MAX_DEPTH) throw new LimitError(`Input depth limit exceeded at ${path}`);
    if (ancestors.has(current)) throw new LimitError(`Cyclic input at ${path}`);
    const prototype = Object.getPrototypeOf(current);
    if ((!Array.isArray(current) && prototype !== null && prototype !== Object.prototype) || (Array.isArray(current) && prototype !== Array.prototype)) throw new LimitError(`Non-JSON object at ${path}`);
    const descriptors = Object.getOwnPropertyDescriptors(current);
    const keys = Reflect.ownKeys(descriptors);
    if (keys.length > MAX_NODES - nodes) throw new LimitError(`Input key limit exceeded at ${path}`);
    ancestors.add(current);
    for (const key of keys) {
      if (Array.isArray(current) && key === 'length') continue;
      if (typeof key !== 'string' || FORBIDDEN_KEYS.has(key)) throw new LimitError(`Unsupported object key at ${path}`);
      characters += key.length;
      if (characters > MAX_BYTES) throw new LimitError(`Input string limit exceeded at ${path}`);
      const descriptor = descriptors[key];
      if (!own(descriptor, 'value') || !descriptor.enumerable) throw new LimitError(`Non-JSON property at ${path}/${escaped(key)}`);
      if (Array.isArray(current) && (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= current.length)) throw new LimitError(`Non-JSON array property at ${path}`);
      visit(descriptor.value, depth + 1, `${path}/${escaped(key)}`);
    }
    if (Array.isArray(current) && keys.length - 1 !== current.length) throw new LimitError(`Sparse array at ${path}`);
    ancestors.delete(current);
  }
  visit(value, 0, '');
  if (Buffer.byteLength(JSON.stringify(value), 'utf8') > MAX_BYTES) throw new LimitError('Serialized input exceeds 1 MiB');
}

export function diffTools(baselineTools, candidateTools, workflows) {
  const changes = [];
  const unsupported = [];
  let operations = 0;
  const tick = () => { if (++operations > MAX_OPERATIONS) throw new LimitError('Contract comparison operation limit exceeded'); };
  const reject = (toolId, path, reason) => unsupported.push({ toolId, path, reason });
  const canonicalCache = new WeakMap();
  function canonical(value) {
    tick();
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (canonicalCache.has(value)) return canonicalCache.get(value);
    const text = Array.isArray(value)
      ? `[${value.map(canonical).join(',')}]`
      : `{${Object.keys(value).sort(compareText).map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
    canonicalCache.set(value, text);
    return text;
  }
  function validateSchema(schema, toolId, path) {
    tick();
    const start = unsupported.length;
    if (!record(schema)) { reject(toolId, path, 'Expected an object schema; boolean schemas are outside this profile'); return false; }
    for (const key of Object.keys(schema).sort(compareText)) {
      tick();
      const next = `${path}/${escaped(key)}`;
      const value = schema[key];
      if (!KEYWORDS.has(key)) { reject(toolId, next, `Unsupported schema keyword: ${key}`); continue; }
      if (key === '$schema' && value !== 'https://json-schema.org/draft/2020-12/schema') reject(toolId, next, 'Only the JSON Schema 2020-12 dialect is supported');
      if ((key === 'description' || key === 'title') && typeof value !== 'string') reject(toolId, next, 'Expected a string annotation');
      if (key === 'type') {
        const values = Array.isArray(value) ? value : [value];
        if (values.length === 0 || values.some(type => !TYPES.has(type)) || new Set(values).size !== values.length) reject(toolId, next, 'Expected known unique JSON Schema type names');
      }
      if (key === 'required' && (!Array.isArray(value) || value.some(x => typeof x !== 'string') || new Set(value).size !== value.length)) reject(toolId, next, 'Expected unique required property names');
      if (key === 'enum' && (!Array.isArray(value) || value.length === 0 || new Set(value.map(canonical)).size !== value.length)) reject(toolId, next, 'Expected a nonempty enum of structurally unique JSON values');
      if (key === 'additionalProperties' && typeof value !== 'boolean') reject(toolId, next, 'Only boolean additionalProperties is supported');
      if (key === 'items') validateSchema(value, toolId, next);
      if (key === 'properties') {
        if (!record(value)) reject(toolId, next, 'Expected an object mapping property names to schemas');
        else for (const name of Object.keys(value).sort(compareText)) validateSchema(value[name], toolId, `${next}/${escaped(name)}`);
      }
    }
    return unsupported.length === start;
  }

  try {
    inspectJson([baselineTools, candidateTools, workflows]);
    for (const [label, collection] of [['baselineTools', baselineTools], ['candidateTools', candidateTools], ['workflows', workflows]]) {
      if (!Array.isArray(collection) || collection.length > MAX_COLLECTION) reject('<input>', `/${label}`, `Expected an array with at most ${MAX_COLLECTION} entries`);
    }
    if (unsupported.length) return { changes, unsupported };
    const workflowIds = new Set();
    const consumers = new Map();
    for (const workflow of workflows) {
      if (!record(workflow) || typeof workflow.id !== 'string' || !workflow.id || workflowIds.has(workflow.id) || !Array.isArray(workflow.dependsOnTools) || workflow.dependsOnTools.some(id => typeof id !== 'string' || !id) || new Set(workflow.dependsOnTools).size !== workflow.dependsOnTools.length) {
        reject('<input>', '/workflows', 'Expected distinct workflow IDs with explicit unique tool dependencies'); continue;
      }
      workflowIds.add(workflow.id);
      for (const toolId of workflow.dependsOnTools) {
        if (!consumers.has(toolId)) consumers.set(toolId, []);
        consumers.get(toolId).push(workflow.id);
      }
    }
    if (unsupported.length) return { changes, unsupported };
    for (const values of consumers.values()) values.sort(compareText);

    function toolsById(tools, label) {
      const map = new Map();
      for (const tool of tools) {
        tick();
        if (!record(tool) || typeof tool.toolId !== 'string' || !tool.toolId) { reject('<input>', `/${label}`, 'Expected tool objects with nonempty toolId'); continue; }
        if (map.has(tool.toolId)) { reject(tool.toolId, `/${label}`, 'Duplicate toolId'); map.get(tool.toolId).valid = false; continue; }
        let valid = true;
        if (own(tool, 'description') && typeof tool.description !== 'string') { reject(tool.toolId, '/description', 'Expected string tool description'); valid = false; }
        const inputValid = validateSchema(tool.inputSchema, tool.toolId, '/inputSchema');
        const outputValid = validateSchema(tool.outputSchema, tool.toolId, '/outputSchema');
        map.set(tool.toolId, { tool, valid: valid && inputValid && outputValid });
      }
      return map;
    }
    const baseline = toolsById(baselineTools, 'baselineTools');
    const candidate = toolsById(candidateTools, 'candidateTools');
    function emit(code, toolId, path, side, before, after) {
      tick();
      changes.push({ code, toolId, path, side, before: snapshot(before), after: snapshot(after), affectedWorkflowIds: [...(consumers.get(toolId) ?? [])] });
    }
    function compareSchema(before, after, toolId, path, side) {
      tick();
      const types = schema => schema.type === undefined ? [] : [...(Array.isArray(schema.type) ? schema.type : [schema.type])].sort(compareText);
      if (canonical(types(before)) !== canonical(types(after))) emit('TYPE_CHANGED', toolId, `${path}/type`, side, before.type, after.type);
      if (normalizedDescription(before.description) !== normalizedDescription(after.description)) emit('DESCRIPTION_CHANGED', toolId, `${path}/description`, side, before.description, after.description);
      if (before.enum !== undefined || after.enum !== undefined) {
        const a = before.enum === undefined ? null : new Set(before.enum.map(canonical));
        const b = after.enum === undefined ? null : new Set(after.enum.map(canonical));
        if ((!a && b) || (a && b && [...a].some(x => !b.has(x)))) emit('ENUM_NARROWED', toolId, `${path}/enum`, side, before.enum, after.enum);
        if ((a && !b) || (a && b && [...b].some(x => !a.has(x)))) emit('ENUM_EXPANDED', toolId, `${path}/enum`, side, before.enum, after.enum);
      }
      if ((before.additionalProperties ?? true) !== (after.additionalProperties ?? true)) emit('ADDITIONAL_PROPERTIES_CHANGED', toolId, `${path}/additionalProperties`, side, before.additionalProperties ?? true, after.additionalProperties ?? true);
      const requiredBefore = new Set(before.required ?? []);
      const requiredAfter = new Set(after.required ?? []);
      for (const name of [...new Set([...requiredBefore, ...requiredAfter])].sort(compareText)) {
        if (!requiredBefore.has(name)) emit(side === 'input' ? 'REQUIRED_PARAMETER_ADDED' : 'OUTPUT_REQUIRED_FIELD_ADDED', toolId, `${path}/required`, side, null, name);
        if (!requiredAfter.has(name)) emit(side === 'input' ? 'REQUIRED_PARAMETER_REMOVED' : 'OUTPUT_REQUIRED_FIELD_REMOVED', toolId, `${path}/required`, side, name, null);
      }
      const propertiesBefore = before.properties ?? {};
      const propertiesAfter = after.properties ?? {};
      for (const name of [...new Set([...Object.keys(propertiesBefore), ...Object.keys(propertiesAfter)])].sort(compareText)) {
        const childPath = `${path}/properties/${escaped(name)}`;
        if (!own(propertiesBefore, name)) emit(side === 'input' ? 'INPUT_PROPERTY_ADDED' : 'OUTPUT_FIELD_ADDED', toolId, childPath, side, undefined, propertiesAfter[name]);
        else if (!own(propertiesAfter, name)) emit(side === 'input' ? 'INPUT_PROPERTY_REMOVED' : 'OUTPUT_FIELD_REMOVED', toolId, childPath, side, propertiesBefore[name], undefined);
        else compareSchema(propertiesBefore[name], propertiesAfter[name], toolId, childPath, side);
      }
      if (before.items !== undefined || after.items !== undefined) compareSchema(before.items ?? {}, after.items ?? {}, toolId, `${path}/items`, side);
    }
    for (const toolId of [...new Set([...baseline.keys(), ...candidate.keys()])].sort(compareText)) {
      const before = baseline.get(toolId);
      const after = candidate.get(toolId);
      if ((before && !before.valid) || (after && !after.valid)) continue;
      if (!before) emit('TOOL_ADDED', toolId, '', 'tool', undefined, after.tool);
      else if (!after) emit('TOOL_REMOVED', toolId, '', 'tool', before.tool, undefined);
      else {
        if (normalizedDescription(before.tool.description) !== normalizedDescription(after.tool.description)) emit('DESCRIPTION_CHANGED', toolId, '/description', 'tool', before.tool.description, after.tool.description);
        compareSchema(before.tool.inputSchema, after.tool.inputSchema, toolId, '/inputSchema', 'input');
        compareSchema(before.tool.outputSchema, after.tool.outputSchema, toolId, '/outputSchema', 'output');
      }
    }
    changes.sort((a, b) => compareText(a.toolId, b.toolId) || compareText(a.path, b.path) || compareText(a.code, b.code) || compareText(canonical(a.before), canonical(b.before)) || compareText(canonical(a.after), canonical(b.after)));
    const uniqueUnsupported = new Map(unsupported.map(item => [canonical(item), item]));
    return { changes, unsupported: [...uniqueUnsupported.values()].sort((a, b) => compareText(a.toolId, b.toolId) || compareText(a.path, b.path) || compareText(a.reason, b.reason)) };
  } catch (error) {
    if (!(error instanceof LimitError)) throw error;
    return { changes: [], unsupported: [{ toolId: '<input>', path: '', reason: error.message }] };
  }
}
