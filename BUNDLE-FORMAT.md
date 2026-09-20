# Bundle format 0.1.0

This reference describes CLI `0.1.0-alpha.3`, with bundle format `0.1.0` and report/engine version `0.1.1`. A bundle contains supplied baseline/candidate recordings; the CLI does not collect them, execute a service, validate their origin or authenticate approvals. The [README](README.md) gives extraction and local-install commands. The core is distributed under the [MIT License](LICENSE).

## Start with a complete example

The package's `examples/scoped-pass.json` is a complete passing bundle; `examples/semantic-regression.json` demonstrates a missing required customer. Both are synthetic. Copy the passing example to `local-bundle.json` using the appropriate command in the README. Preserve it as a baseline for editing rather than constructing fields from guessed names.

For a small synthetic adaptation, first declare that `customer_trial_required_003` must be present. The following local Node script edits only your copied JSON: it records that ID in both fixtures and the baseline result, protects it with assertion `a2`, and removes it from the candidate result.

```sh
node <<'NODE'
const fs = require('node:fs');
const b = JSON.parse(fs.readFileSync('local-bundle.json', 'utf8'));
const required = 'customer_trial_required_003';
b.assertions[1].value = required;
for (const side of ['baseline', 'candidate']) {
  b[side].fixture.seedData[1].id = required;
}
b.baseline.observations[0].result.customerIds[1] = required;
b.candidate.observations[0].result.customerIds = ['customer_001'];
fs.writeFileSync('local-bundle.json', JSON.stringify(b, null, 2) + '\n');
NODE
```

From the extracted `package` directory, run `node src/cli.mjs check local-bundle.json > report.json`. From the npm installation directory, run `./node_modules/.bin/drift check local-bundle.json > report.json`. Expected result: `FAIL`, exit 1, baseline `a2: PASS`, candidate `a2: FAIL`. This edits synthetic recordings; it is not a live capture or repair.

## Fields and references

Use UTF-8 JSON with an object at its root. All seven root fields below are required. Field names are case-sensitive. Unknown fields in the listed domain objects return `UNSUPPORTED`; free-form JSON data belongs in fixture `input`/`seedData`, observation `result`/`sideEffects`, or additional environment fields.

| Root field | Shape |
|---|---|
| `bundleVersion` | Exactly the string `"0.1.0"`; this is separate from the CLI package version. |
| `integration` | Object containing nonblank string `id` and `name`. |
| `workflows` | Array of workflow objects described below. |
| `assertions` | Array of assertion objects described below. An empty array cannot yield PASS_SCOPED. |
| `baseline`, `candidate` | Each an object with required `toolVersions` array and comparison evidence in `fixture` and `observations`. |
| `comparisonPolicy` | The fixed policy shown below. |

Domain IDs, names, comparison metadata and entries in declared string lists must be nonblank and at most 500 JavaScript string characters, subject to the missing-metadata rules below. Descriptions and paths have separate limits. Strings inside free-form JSON data and schemas follow the overall input limits instead. Domain collections such as workflows, assertions, tool versions, observations and metadata lists have at most 1,000 entries; embedded data arrays have a separate limit below. IDs are unique within their respective collections: workflows, assertions, each side's tools by `toolId`, and each side's observations by `observationId`. They do not need to be globally unique across different collections. String lists are unique except fixture `permissions`, whose duplicate entries are ignored for comparison.

**Workflow:** required `id`, `dependsOnTools` (array of tool ID strings), `businessExpectations` (array of strings), and `criticality` (`low`, `medium`, `high` or `critical`). Optional `description` may be blank and at most 8,000 characters. Each dependency must exist in at least one side's tool inventory. Expectation text documents intent; only an assertion evaluates it. Every requested workflow needs an assertion for an overall PASS_SCOPED.

**Tool version:** required `toolId`, `name`, `inputSchema` and `outputSchema`; use object schemas from the supported profile below. Include nonblank string `version`, `source` and `capturedAt` on every tool on each side. These three fields may be omitted, null or blank in a parseable input, but that makes comparison `INCONCLUSIVE`. They are declared metadata, not verified identities. Date and semantic-version syntax are not validated. Optional `description` may be blank and at most 8,000 characters. Tool IDs pair the inventories. A version/name/source/timestamp change alone does not generate a contract-change finding.

**Observation:** required `observationId`, `workflowId`, `toolId`; include `httpStatus` and `result` for usable evidence. `httpStatus`, if present, must be an integer from 100 to 599; comparison requires 200–299. `result` may be any permitted JSON value, including null. Optional `sideEffects` is an array of JSON data; the engine does not evaluate it or verify the absence of real side effects. Each observation's workflow must exist, and its tool must be a declared dependency of that workflow. A tool absent from both inventories is an input error; absent only from that observation's side makes comparison inconclusive.

Pair observations using the same `observationId` in both sides, with matching `toolId` and `workflowId`. An assertion selecting that ID must use the observation's `workflowId`; mismatched assertion references are input errors. For otherwise valid observations, changed paired tool/workflow IDs make comparison `INCONCLUSIVE` with reason `DIFFERENT`. Every observation appearing on either side, and every ID selected by an assertion, needs a counterpart with a result and successful status. `observations` may be omitted, or an observation may omit `result`/`httpStatus`, but these omissions prevent a comparable result when that observation is needed. Matching identities are declarations and do not authenticate capture origin.

## Fixture controls

Use this exact policy; the dimension array can be reordered but cannot omit or add a dimension, and entries must be unique:

```json
{
  "requiredFixtureDimensions": [
    "input", "environment", "permissions", "seedData", "clock", "locale", "timezone"
  ],
  "toolVersionsAreTreatment": true
}
```

Each side's `fixture` should contain all fields in this table. Missing/null fixtures are parseable but produce `INCONCLUSIVE`.

| Fixture field | Required evidence and comparison |
|---|---|
| `fixtureId` | Nonblank string on both sides. Presence is checked; ID equality is not a comparison control. Use a stable descriptive ID. |
| `input` | Explicit JSON value, including null if that is the actual input. Deep equality across sides; array order matters. |
| `environment` | Object with nonblank string `kind`, `region`, `model`, `promptVersion`, `runtimeProfile`. Each is compared individually. Additional fields are allowed; all fields present on either side must have matching recorded values. |
| `permissions` | Array of nonblank strings. Compared as sets, ignoring order and duplicates; an empty array is recorded evidence. |
| `seedData` | Explicit JSON value, including null if appropriate. Deep equality; array order matters. |
| `clock`, `locale`, `timezone` | Nonblank strings. Each must match exactly; date/locale/timezone syntax is not validated. |

Object key order is ignored in deep equality. Missing data is distinct from explicit null for `input` and `seedData`. Null or blank metadata means unknown; do not replace unknown controls with invented values. Additional environment data may have any permitted JSON shape, but a missing/null/blank value is not a recorded control. The engine only compares declarations; it cannot identify hidden environmental differences.

Tool versions are the intended treatment. Fixture changes, including model or prompt-version changes, make the comparison `INCONCLUSIVE`. Missing capture metadata, missing paired observations or results, changed observation tool/workflow identities, absent per-side tools, and unsuccessful HTTP statuses also prevent comparable regression attribution. Different successful statuses (for example 200 and 201) do not by themselves make controls non-comparable.

## Assertions and paths

Each assertion requires nonblank string `id`, `workflowId`, `observationId`, `type`, plus string `path`. `workflowId` must reference a workflow. The `id` cannot be `__proto__`, `constructor` or `prototype`. The engine applies the same assertion to both runs. Select `path` relative to the chosen observation's **result**, not the bundle root.

| `type` | `value` operand | Pass condition |
|---|---|---|
| `equals` | Required; any permitted JSON value, including null, objects and arrays. | Selected value is structurally equal. Object key order is ignored; array order is significant. |
| `includes` | Required; scalar string, number, boolean or null. | Selected value is an array containing the scalar with exact type and value. No string substring or object matching. |
| `minCount` | Required; nonnegative safe integer. | Selected value is an array with at least this many elements. |
| `exists` | Must be omitted. | The selected path exists, even if its value is null, false or an empty value. |

For example, each of these is a complete assertion object that can be added to the sample, with distinct IDs:

```json
[
  {"id":"first-customer","workflowId":"cancellation-review","observationId":"primary","type":"equals","path":"/customerIds/0","value":"customer_001"},
  {"id":"required-customer","workflowId":"cancellation-review","observationId":"primary","type":"includes","path":"/customerIds","value":"customer_002"},
  {"id":"at-least-two","workflowId":"cancellation-review","observationId":"primary","type":"minCount","path":"/customerIds","value":2},
  {"id":"has-customer-list","workflowId":"cancellation-review","observationId":"primary","type":"exists","path":"/customerIds"}
]
```

`path` uses RFC 6901 string-pointer syntax: `""` selects the whole result; `/customerIds/0` selects index 0; `~1` escapes `/` and `~0` escapes `~` within a key. A single `/` selects an empty-string key. Maximum length is 256 JavaScript string characters and 32 segments. Array indices use `0` or a positive integer without leading zeros; `/01` or `/-` will not select an array element. Segments `__proto__`, `constructor` and `prototype` are forbidden. URI fragments, JSONPath, expressions, URL fetching and filesystem references are not supported. A `*` is just a literal key, not a wildcard.

A missing selected path fails the assertion. A missing observation/result instead yields a `MISSING` assertion outcome and incomplete evidence; this is not proof of a regression. Wrong selected value types fail `includes`/`minCount`. Unsupported operators, malformed pointers, missing operands, composite `includes` operands, or a `value` on `exists` produce `UNSUPPORTED`.

## Supported contract profile and limits

`inputSchema` and `outputSchema` are structural comparison inputs, not response validators. All nested schemas must be objects. The only supported keywords are:

| Keyword | Supported value |
|---|---|
| `$schema` | Omitted or exactly `https://json-schema.org/draft/2020-12/schema`. |
| `type` | One of `null`, `boolean`, `object`, `array`, `number`, `integer`, `string`, or a nonempty array of distinct such strings. |
| `properties` | Object mapping property names to supported object schemas. |
| `required` | Array of distinct property-name strings; order is ignored. |
| `enum` | Nonempty array of structurally distinct JSON values; order is ignored. |
| `items` | One supported object schema; omission compares as `{}`. |
| `additionalProperties` | Boolean only; omission compares as `true`. |
| `description`, `title` | Strings. Description whitespace is normalized; substantive description changes are hypotheses about meaning. Titles do not generate changes. |

Boolean schemas, `$ref`/`$defs`, composition such as `anyOf`, schema-valued `additionalProperties`, constraints such as `format`/`pattern`/`minimum`/`minItems`, and every unlisted keyword are unsupported, even when unchanged or attached to an added/removed tool. No logical compatibility proof or instance-to-schema validation is performed.

The CLI reads one local regular file, up to 1 MiB, with valid UTF-8 JSON. It rejects duplicate object keys, nesting beyond 64 levels, more than 50,000 JSON values, dangerous object keys anywhere, non-finite numbers, unsafe integer values and numeric spellings that lose decimal distinctions on JavaScript conversion. JSON arrays are additionally limited to 10,000 entries; domain collections have the smaller 1,000-entry limit. Processing and report budgets may reject smaller inputs too: no partial result becomes a pass. Numbers are not arbitrary precision; represent large IDs as strings. Symlink input files and URL arguments are rejected. These limits are not an operating-system sandbox.

## Reading the report

Reports go to stdout. Failed-assertion findings include the following context in report version `0.1.1`:

| Field | Meaning |
|---|---|
| `issueId` | Shared by the semantic-change and behavior-regression findings for the same failed assertion; group these as one issue. |
| `assertionContext.definitionPointer` | Pointer to the assertion definition in the submitted bundle. |
| `assertionContext.type`, `resultPath`, `observationId` | The assertion operator, path relative to its observation result, and selected observation ID. |
| `assertionContext.expectedEvidence` | Evidence for the assertion's expected `value`, with `pointer`, `exists`, `preview`, `sha256` and `truncated`. An `exists` assertion has no operand, so its expected evidence has `exists: false`. |
| `workflowEvidence` | Bounded canonical evidence for the referenced workflow, including its declared description and business expectations when supplied. |
| `baselineEvidence`, `candidateEvidence` | The selected recorded values, or missing-value evidence. |

Evidence contains a bundle pointer, existence flag, canonical-value hash and a preview of up to 1,000 JavaScript string characters. `truncated: true` means the preview is incomplete; inspect the retained input for full evidence. Cross-reference `assertionId` and `affectedWorkflowIds` with that input when further context is needed. Hashes identify supplied content, not its source. Report `0.1.0` from the earlier alpha did not include the new context/grouping fields.

| Exit/status | Interpretation |
|---|---|
| 0 / `PASS_SCOPED` | All supplied candidate assertions passed under comparable declared controls, and every requested workflow has an assertion. A baseline failure does not prevent this status when the candidate passes. |
| 1 / `FAIL` | A candidate assertion failed under comparable controls. Only an assertion that passed on the baseline receives `BEHAVIOR_REGRESSION`; an already failing baseline instead yields `INSUFFICIENT_EVIDENCE`. |
| 2 / `REVIEW` | No assertions, or a would-be pass has requested workflows with no assertions. |
| 2 / `INCONCLUSIVE` | Required controls or observation evidence are missing, unsuccessful or different. Inspect `comparison.uncontrolled`. |
| 2 / `UNSUPPORTED` | Bundle version, fields, operator, schema feature or another bounded profile feature is unsupported. Inspect `diagnostics`. |
| 3 / input or engine error | Evaluation did not complete. Structured error goes to stderr; stdout may be empty. Preserve the exit code. |

Malformed shapes and invalid references can be input errors rather than `UNSUPPORTED`; parser/resource refusals can also exit 3. Unsupported schema/profile diagnostics can take precedence over comparability findings. A single newly failing assertion normally produces both `SEMANTIC_CHANGE` and `BEHAVIOR_REGRESSION` findings with the same `issueId`; that is one failed expectation, not two independent defects. Contract findings can coexist with PASS_SCOPED because a scoped assertion pass does not establish integration-wide safety.
