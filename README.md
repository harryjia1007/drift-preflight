# Drift Preflight 0.1.0-alpha.3

Compare recorded baseline/candidate tool behavior against explicit workflow assertions. Reports explain what changed, which workflow depends on it, and which supplied evidence supports a finding.

An MIT-licensed local CLI for early evaluation. It checks supplied recordings; it does not authenticate their origin or certify an integration as safe. Human onboarding, production workloads and engineering-time savings remain unverified.

第一次使用终端机？请看 [Mac 中文新手操作流程](QUICKSTART.zh-CN.md)，包含逐步命令、预期结果和出错处理。

## Run from the source checkout

With Node.js 24 installed, run from this repository directory:

```sh
node src/cli.mjs --help
node src/cli.mjs check examples/scoped-pass.json
node src/cli.mjs check examples/semantic-regression.json
```

No npm install is needed. The examples deliberately return exit 0 and exit 1 respectively. For your own bundle, use this directory wherever the instructions below say extracted `package`. This repository contains the core and usage documentation; historical reproduction labs and internal audit logs are not included.

## Download and try the examples

Requires **Node.js major 24**. The currently verified platform is **macOS arm64**; other platforms have not been validated. After download, the extracted package needs no API key, Python, network access or dependency installation.

Download `harryjia1007-drift-preflight-0.1.0-alpha.3.tgz` and `SHA256SUMS` from the [alpha.3 release](https://github.com/harryjia1007/drift-preflight/releases/tag/v0.1.0-alpha.3) into a new folder.

Open a terminal in that folder. Verify the checksum before extracting:

```sh
shasum -a 256 -c SHA256SUMS
```

Continue only if the archive is reported as `OK`. The checksum identifies the bytes; obtain the files from the intended project release rather than an unknown source. Then run:

```sh
tar -xzf harryjia1007-drift-preflight-0.1.0-alpha.3.tgz
cd package
node src/cli.mjs --help
node src/cli.mjs check examples/scoped-pass.json
node src/cli.mjs check examples/semantic-regression.json
```

The first check returns PASS_SCOPED / exit 0. The second deliberately demonstrates a missing required customer and returns FAIL / exit 1. Both are synthetic recorded fixtures. A failing example is not an installation failure.

The package also provides a `drift` command through an optional local npm installation. In a separate empty trial directory, run:

```sh
npm install --offline --ignore-scripts /path/to/harryjia1007-drift-preflight-0.1.0-alpha.3.tgz
./node_modules/.bin/drift --help
```

Replace `/path/to/` with the actual archive directory. This installs the downloaded archive, with scripts disabled. Nothing needs to be installed globally.

## Your own local bundle

Start from the complete passing example, then edit it using the [bundle format and missing-customer recipe](BUNDLE-FORMAT.md). The reference specifies required fields, comparison controls, assertion operands and supported JSON Pointer paths. Declare the business expectation before evaluating the candidate. Use only permitted, minimized data; reports may contain input excerpts.

From the extracted `package` directory, copy the example, edit `local-bundle.json`, then run the same Node entry point:

```sh
cp examples/scoped-pass.json local-bundle.json
node src/cli.mjs check local-bundle.json > report.json
```

If you chose the local npm installation, run these from that installation's trial directory instead:

```sh
cp node_modules/@harryjia1007/drift-preflight/examples/scoped-pass.json local-bundle.json
./node_modules/.bin/drift check local-bundle.json > report.json
```

The unedited copy returns PASS_SCOPED / exit 0; the reference's missing-customer recipe returns FAIL / exit 1. Preserve the command's exit code. Exit 3 writes an error to stderr and may leave `report.json` empty.

The engine never fetches URLs, starts MCP servers, runs uploaded code or calls a model. It evaluates the supplied JSON and does not prove that the underlying service actually produced it.

## Reading the result

| Exit | Status | Meaning |
|---|---|---|
| 0 | PASS_SCOPED | Supplied comparable assertions passed; not integration-wide safety. |
| 1 | FAIL | A supplied assertion failed; new regression attribution additionally requires baseline success. |
| 2 | REVIEW / INCONCLUSIVE / UNSUPPORTED | Review, missing comparability or unsupported semantics; do not count as success. |
| 3 | Input / engine error | Analysis did not complete. |

Supported assertions: `equals`, scalar `includes`, `minCount`, `exists`. Contract analysis is a finite structural JSON Schema subset, not full conformance validation. Model/prompt changes currently make controls non-comparable. Unsupported operations are explicit.

Failed-assertion findings include `assertionContext` with the operator, result path and expected-value evidence, plus `workflowEvidence` for the affected workflow. Inspect these alongside the baseline/candidate evidence. A semantic-change and behavior-regression finding for the same failed assertion share an `issueId`; count that as one issue. Previews can be truncated, so retain the input for full context. See [report interpretation](BUNDLE-FORMAT.md#reading-the-report).

Known limits: authored fixture coverage, unauthenticated recordings, hidden environment differences, no side-effect detection, no HTML report, no cloud service or automatic repair. Engineering time savings and paid demand have not been demonstrated. Keep the exit code when integrating checks into CI.

See [security scope and private reporting](SECURITY.md) and the [MIT license](LICENSE). Project home: [harryjia1007/drift-preflight](https://github.com/harryjia1007/drift-preflight). This archive intentionally omits research logs, Python source reproductions, customer data and development scripts.

To stop a trial, stop invoking this local command. No service or background process is installed. Keep the original inputs and treat each new version as a separately verified artifact; no earlier public release is recommended as a rollback.

## Share feedback

[Report a bug or documentation problem](https://github.com/harryjia1007/drift-preflight/issues/new?template=bug-report.yml) or [share an actual trial attempt](https://github.com/harryjia1007/drift-preflight/issues/new?template=trial-feedback.yml), including attempts that got stuck. Sign in to GitHub to submit a report. The trial form separates first use, repeated examples and a later task; timing and tool comparisons are optional.

Issues are public. Share short, sanitized summaries or synthetic examples; exclude secrets, company/customer names, private paths, raw bundles and full logs. Send suspected vulnerabilities through [private reporting](https://github.com/harryjia1007/drift-preflight/security/advisories/new). Feedback is self-reported and does not by itself establish time savings or product demand.
