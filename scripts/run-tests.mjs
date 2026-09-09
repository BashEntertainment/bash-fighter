#!/usr/bin/env node
// Cross-Node-version test runner wrapper.
//
// node:test gained a same-process test mode (no per-file child process,
// which is what was OOM-killing the suite under default concurrency) --
// but which Node CLI builds actually accept the --test-isolation=none
// flag is not reliably knowable from a version number (see
// scripts/lib/isolation-flag.mjs's comment for the two wrong guesses
// that shipped before this one). So this wrapper asks the Node binary
// directly, once, before running the real suite.
//
// If the running Node genuinely doesn't support the flag, this falls
// back to running with default (per-file) isolation and
// --test-concurrency=1, which is slower but memory-safe, and says so
// loudly rather than just failing -- a CI red light here should mean "a
// test failed", not "the runner script gave up". See CONTRIBUTING.md
// "Running the tests".
import { spawnSync } from 'node:child_process';
import process from 'node:process';
import { probeIsolationFlag } from './lib/isolation-flag.mjs';

const choice = probeIsolationFlag();

let testFlags;
if (choice.supported) {
  testFlags = [choice.flag];
  console.error(`run-tests.mjs: Node ${process.versions.node}, using ${choice.flag}`);
} else {
  testFlags = ['--test-concurrency=1'];
  console.error(
    `run-tests.mjs: WARNING -- ${choice.reason} Falling back to one-process-per-file ` +
      `with --test-concurrency=1 (slower, but still memory-safe).`,
  );
}

const args = process.argv.slice(2);
// Capture output (not just inherit) so that on failure we can surface the
// actual failing test names as ::error:: annotations -- useful in CI where
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
