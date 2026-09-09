#!/usr/bin/env node
// Cross-Node-version test runner wrapper.
//
// node:test gained a same-process test mode (no per-file child process,
// which is what was OOM-killing the suite under default concurrency)
// around Node 22.8. The flag started experimental
// (--experimental-test-isolation) and was later given the stable name
// --test-isolation, with both kept as aliases afterwards. Which exact
// patch a given Node 22.x install has is not something to guess from
// the version string (we tried a version-number heuristic first and it
// broke on Node 22.23.2, where "23" is a patch count, not a cutover
// point) — so this wrapper feature-detects via
// process.allowedNodeEnvironmentFlags instead. See CONTRIBUTING.md
// "Running the tests" for the memory numbers this flag fixes.
import { spawnSync } from 'node:child_process';

// Feature-detect the flag name instead of guessing from the Node version
// string: Node 22.8-ish renamed --experimental-test-isolation to the
// stable --test-isolation at some patch release, and the two names are
// aliases from that point on, but "which minor number" is not a safe
// thing to hardcode (we shipped a `minor < 23` guess that broke on
// Node 22.23.x, where 23 is just a patch count, not a new major).
// process.allowedNodeEnvironmentFlags is Node's own registry of flags
// the running binary understands, so this works on any version.
const flagName = process.allowedNodeEnvironmentFlags.has('--test-isolation')
  ? '--test-isolation'
  : process.allowedNodeEnvironmentFlags.has('--experimental-test-isolation')
    ? '--experimental-test-isolation'
    : null;

if (!flagName) {
  console.error(
    `run-tests.mjs: Node ${process.versions.node} has no --test-isolation ` +
      `flag (needs 22.8+). Upgrade Node or run \`node --test\` on ` +
      `individual files instead.`,
  );
  process.exit(1);
}
const isolationFlag = `${flagName}=none`;

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
