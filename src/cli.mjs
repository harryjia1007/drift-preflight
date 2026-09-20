#!/usr/bin/env node
import { realpathSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { readBoundedText } from './scoring.mjs';
import { analyzeText, BundleInputError } from './engine.mjs';

export function main(args) {
  if (args.length === 1 && args[0] === '--version') {
    process.stdout.write(JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version + '\n');
    return 0;
  }
  if (args.length === 1 && args[0] === '--help') {
    process.stdout.write('Drift Preflight — local recorded-behavior checks\n\nUsage: drift check local-bundle.json\n       drift --version\n\nJSON evidence goes to stdout. No service or model is called.\nExit 0 PASS_SCOPED: only supplied comparable assertions passed.\nExit 1 FAIL: an assertion failed.\nExit 2 REVIEW / INCONCLUSIVE / UNSUPPORTED: review required.\nExit 3 input or engine error: evaluation did not complete.\n\nA scoped pass does not prove integration-wide safety.\n');
    return 0;
  }
  if (args.length !== 2 || args[0] !== 'check' || /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(args[1]) || args[1].startsWith('-')) {
    process.stderr.write(JSON.stringify({ error: 'INPUT_ERROR', message: 'Usage: drift check local-bundle.json' }) + '\n');
    return 3;
  }
  try {
    const report = analyzeText(readBoundedText(args[1]));
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
    return report.status === 'PASS_SCOPED' ? 0 : report.status === 'FAIL' ? 1 : 2;
  } catch (error) {
    const diagnostics = error instanceof BundleInputError ? error.diagnostics : [];
    // JSON parser messages can contain excerpts. Never echo them or a local path.
    process.stderr.write(JSON.stringify({ error: 'INPUT_ERROR', message: 'Local bundle rejected: invalid, unsupported input shape or resource limit. No evaluation completed.', diagnostics }) + '\n');
    return 3;
  }
}
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
