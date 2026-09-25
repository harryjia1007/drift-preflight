# Drift Preflight 0.1.0-alpha.3

First public preview of the MIT-licensed local CLI. Compare supplied baseline/candidate recordings against explicit business assertions and inspect JSON evidence for the affected workflow.

第一次使用终端机？请看 [Mac 中文新手操作流程](https://github.com/harryjia1007/drift-preflight/blob/main/QUICKSTART.zh-CN.md)，包含逐步命令、预期结果和出错处理。

## Included

- Four deterministic assertions: equals, scalar includes, minCount and exists.
- Five result states with explicit exit codes and comparison controls.
- Finite structural schema diffs, bounded evidence context and protected tool/workflow identity.
- Complete bundle format, two synthetic examples and an offline install path.
- No third-party runtime dependencies, API key, model call, telemetry, background service or hosted account.

## Download and verification

Archive: `harryjia1007-drift-preflight-0.1.0-alpha.3.tgz` (27258 bytes). Download it with `SHA256SUMS` and run `shasum -a 256 -c SHA256SUMS` before extracting. `manifest.json` lists all twelve runtime files and their hashes.

SHA-256: `14b459f117506809cb3df2b2876714bd278916ec761c4a0ca3a593baa6a6b121`.

Verified on macOS arm64 / Node.js 24.16.0: 172 maintainer tests passed; offline installation matched all 12 file hashes; 7 installed status/error/identity scenarios and 2 extracted examples passed. The failing example intentionally returns FAIL / exit 1. Other platforms and human onboarding remain unverified.

## Scope and limits

The CLI analyzes supplied recordings. It does not collect live data, authenticate the recording source, validate complete response schemas or prove an integration is safe. Reports can contain sensitive input excerpts. Read [SECURITY.md](https://github.com/harryjia1007/drift-preflight/blob/main/SECURITY.md) before using permitted data; report vulnerabilities through the repository's private reporting form.

This preview has no measured human time-saving, customer-demand or payment claim. Ordinary tests and official Promptfoo can detect the same demonstrated query regression. The product hypothesis is reduced preparation, review and repeated maintenance effort, which still requires human trials.

Earlier alpha.1/alpha.2 archives were internal candidates. Alpha.3 selects MIT and completes public distribution metadata/documentation; the five runtime module bytes match the verified alpha.2 engine. Input format remains 0.1.0 and engine/report format remains 0.1.1. npm publication remains disabled; use this GitHub download or the source checkout.
