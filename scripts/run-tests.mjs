#!/usr/bin/env node
// Cross-Node-version test runner wrapper.
//
// node:test gained a same-process test mode (no per-file child process,
// which is what was OOM-killing the suite under default concurrency) in
// Node 22.8, but the CLI flag's name changed as it stabilised:
//   - Node 22.8-22.x : --experimental-test-isolation=none
//   - Node 23+/24+   : --test-isolation=none (stable name)
// This wrapper picks the right flag for whichever Node runs it, so one
// npm script works on both CI matrix versions (22 and 24) and on
// contributors' machines without anyone needing to know the difference.
// See CONTRIBUTING.md "Running the tests" for the memory numbers this
// flag fixes.
import { spawnSync } from 'node:child_process';

const [major, minor] = process.versions.node.split('.').map(Number);
const isolationFlag =
  major === 22 && minor < 23
    ? '--experimental-test-isolation=none'
    : major < 22
      ? null
      : '--test-isolation=none';

if (!isolationFlag) {
  console.error(
    `run-tests.mjs: Node ${process.versions.node} is too old for ` +
      `--test-isolation (needs 22.8+). Upgrade Node or run \`node --test\` ` +
      `on individual files instead.`,
  );
  process.exit(1);
}

const args = process.argv.slice(2);
console.error(
  `run-tests.mjs: Node ${process.versions.node}, using flag ${isolationFlag}`,
);
const result = spawnSync(
  process.execPath,
  ['--test', isolationFlag, ...args],
  { stdio: 'inherit' },
);

if (result.error) {
  console.log(`::error::run-tests.mjs spawn error: ${result.error.stack || result.error}`);
}
if (result.status !== 0) {
  console.log(
    `::error::run-tests.mjs: node --test ${isolationFlag} exited ${result.status} (signal ${result.signal}) on Node ${process.versions.node}`,
  );
}

process.exit(result.status ?? 1);
