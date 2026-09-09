// Decide whether the running Node binary actually supports
// --test-isolation=none, by asking it directly rather than guessing from
// a version number or from process.allowedNodeEnvironmentFlags (a
// registry of NODE_OPTIONS-eligible flags, not all CLI flags).
//
// This module went through two wrong versions before this one, both of
// which shipped and broke CI on Node 22.23.2 specifically:
//   1. A `minor < 23` version-number heuristic.
//   2. process.allowedNodeEnvironmentFlags.has('--test-isolation') --
//      which does correctly say "not present" on that runtime, but was
//      second-guessed and replaced based on version-number reasoning
//      ("22.8.0 shipped the `isolation` *option*, so 22.23.2 must have
//      the *CLI flag* too") that turned out to be false: the docs'
//      "Added the isolation option" changelog entry is about the
//      programmatic node:test `run()` API, not the `--test-isolation`
//      CLI flag, which only stabilised later. The actual Node 22.23.2
//      binary rejects it outright: `bad option: --test-isolation=none`
//      (confirmed from the real CI job log).
//
// The only way to know for certain, on any Node version, present or
// future, is to ask the binary. spawnSync is cheap (a few ms) next to
// the seconds the test suite itself takes.
import { spawnSync } from 'node:child_process';

/**
 * @param {string} [nodeExecPath] defaults to process.execPath
 * @returns {{ supported: true, flag: string } | { supported: false, reason: string }}
 */
export function probeIsolationFlag(nodeExecPath = process.execPath) {
  const result = spawnSync(nodeExecPath, ['--test-isolation=none', '-e', 'process.exit(0)'], {
    encoding: 'utf8',
  });
  const stderr = result.stderr || '';
  if (result.status === 0 && !/bad option/i.test(stderr)) {
    return { supported: true, flag: '--test-isolation=none' };
  }
  return {
    supported: false,
    reason:
      `This Node binary (${nodeExecPath}) rejected --test-isolation=none ` +
      `(${stderr.trim() || `exit code ${result.status}`}).`,
  };
}

// Kept for the unit test: a pure, deterministic version of the same
// decision, driven off a captured probe result instead of actually
// spawning a process, so the test suite doesn't depend on which Node
// happens to be running it.
/**
 * @param {{ status: number, stderr: string }} probeResult
 */
export function decideFromProbeResult(probeResult) {
  const stderr = probeResult.stderr || '';
  if (probeResult.status === 0 && !/bad option/i.test(stderr)) {
    return { supported: true, flag: '--test-isolation=none' };
  }
  return {
    supported: false,
    reason: `rejected --test-isolation=none (${stderr.trim() || `exit code ${probeResult.status}`}).`,
  };
}
