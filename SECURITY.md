# Security scope and reporting

Drift Preflight 0.1.0-alpha.3 reads one explicitly selected local JSON file and writes JSON evidence to stdout. No network, credentials, subprocess, MCP server, uploaded code, LLM or automatic repair capability is present in the runtime package. Downloading the release is separate from running the local CLI.

Inputs, depth, operations and output are bounded; see the [bundle limits](BUNDLE-FORMAT.md#supported-contract-profile-and-limits). Rejections do not become partial passes. These checks are not an OS sandbox or a guarantee against a compromised host/workspace. Supplied source/version/control labels do not authenticate a recording or prove the absence of hidden differences.

Use synthetic or authorized minimized data. Do not supply production credentials or secrets. Local reports retain the sensitivity of input excerpts, including assertion and workflow context; choose appropriate file permissions and retention. The CLI does not redact reports or upload them automatically.

Testing and AI review are limited evidence, not an independent security audit. macOS arm64 with Node 24 is the current verified platform. Other platforms, production workloads and general customer-service replay have not been validated.

## Report a vulnerability privately

Use [GitHub private vulnerability reporting](https://github.com/harryjia1007/drift-preflight/security/advisories/new). You must sign in to GitHub to submit a private report.

Include the CLI version, Node version, operating system, expected versus observed behavior, and a small synthetic reproduction where possible. Exclude credentials, customer data and private absolute paths. Keep potentially sensitive findings out of public issues, discussions and pull requests.

If GitHub does not offer a private report, open a public issue containing only a request for a private reporting channel. Keep vulnerability details and reproduction files local until a private route is available.
