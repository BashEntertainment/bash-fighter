#!/usr/bin/env node
// Cross-Node-version test runner wrapper.
//
// node:test gained a same-process test mode (no per-file child process,
// which is what was OOM-killing the suite under default concurrency)
// from Node 22.8.0 onward, via --test-isolation=none. Which Node
// versions have it is decided by scripts/lib/isolation-flag.mjs (see
// that file's comment and scripts/test/isolation-flag.test.ts for why
// this is its own tested module and not inline logic — two earlier
// inline attempts here both misjudged Node 22.23.2 as too old).
//
// If the running Node genuinely doesn't support the flag, this falls
// back to running with default (per-file) isolation and
// --test-concurrency=1, which is slower but memory-safe, and says so
// loudly rather than just failing — a CI red light here should mean "a
// test failed", not "the runner script gave up". See CONTRIBUTING.md
// "Running the tests".
import { spawnSync } from 'node:child_process';
import process from 'node:process';
import { pickIsolationFlag } from './lib/isolation-flag.mjs';

const choice = pickIsolationFlag(process.versions.node);

let testFlags;
if (choice.supported) {
  testFlags = [choice.flag];
  console.error(`run-tests.mjs: Node ${process.versions.node}, using ${choice.flag}`);
} else {
  testFlags = ['--test-concurrency=1'];
  console.error(
    `run-tests.mjs: WARNING — ${choice.reason} Falling back to one-process-per-file ` +
      `with --test-concurrency=1 (slower, but still memory-safe). If you see this in CI, ` +
      `the Node version in the workflow matrix is older than we intend to support.`,
  );
}

const args = process.argv.slice(2);
// Capture output (not just inherit) so that on failure we can surface the
// actual failing test names as ::error:: annotations — useful in CI where
// nobody signed in can otherwise see the raw job log.
const result = spawnSync(
  process.execPath,
  ['--test', ...testFlags, ...args],
  { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
);
if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);

if (result.error) {
  console.log(`::error::run-tests.mjs spawn error: ${result.error.stack || result.error}`);
}
if (result.status !== 0) {
  const combined = `${result.stdout || ''}\n${result.stderr || ''}`;
  const notOkLines = combined
    .split('\n')
    .filter((l) => l.startsWith('not ok'))
    .slice(0, 20);
  for (const line of notOkLines) {
    console.log(`::error::${line.replace(/\r$/, '')}`);
  }
  if (notOkLines.length === 0) {
    const tail = combined.trim().split('\n').slice(-15).join(' | ');
    console.log(`::error::run-tests.mjs: no TAP failures found; tail of output: ${tail}`);
  }
  console.log(
    `::error::run-tests.mjs: node --test ${testFlags.join(' ')} exited ${result.status} (signal ${result.signal}) on Node ${process.versions.node}`,
  );
}

process.exit(result.status ?? 1);
