import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseNodeVersion, compareVersions, pickIsolationFlag } from '../lib/isolation-flag.mjs';

test('parseNodeVersion parses three numeric components', () => {
  assert.deepEqual(parseNodeVersion('22.23.2'), [22, 23, 2]);
  assert.deepEqual(parseNodeVersion('24.20.0'), [24, 20, 0]);
  assert.deepEqual(parseNodeVersion('22.8.0'), [22, 8, 0]);
});

test('compareVersions compares numerically, not lexicographically', () => {
  // The regression this guards: "23" must compare greater than "8", not
  // less than it the way string comparison ("2" < "8") would suggest.
  assert.equal(compareVersions([22, 23, 2], [22, 8, 0]), 1);
  assert.equal(compareVersions([22, 8, 0], [22, 23, 2]), -1);
  assert.equal(compareVersions([22, 8, 0], [22, 8, 0]), 0);
  assert.equal(compareVersions([24, 20, 0], [22, 8, 0]), 1);
  assert.equal(compareVersions([22, 7, 9], [22, 8, 0]), -1);
});

test('pickIsolationFlag: known-good and known-bad Node versions', () => {
  // Below the cutover.
  assert.equal(pickIsolationFlag('22.7.0').supported, false);
  // Exactly at the cutover.
  assert.equal(pickIsolationFlag('22.8.0').supported, true);
  // The version that broke both previous attempts: minor "23" is a
  // patch-series number on Node 22, not a new major, and must still
  // compare as "well past 22.8".
  assert.equal(pickIsolationFlag('22.23.2').supported, true);
  // A current Node 24.
  assert.equal(pickIsolationFlag('24.20.0').supported, true);
  // Awkward edge cases: patch-only difference either side of the cutover,
  // and a hypothetical future major.
  assert.equal(pickIsolationFlag('22.8.1').supported, true);
  assert.equal(pickIsolationFlag('21.9.0').supported, false);
  assert.equal(pickIsolationFlag('30.0.0').supported, true);

  const flag = pickIsolationFlag('22.23.2');
  assert.equal(flag.flag, '--test-isolation=none');
});

test('pickIsolationFlag reports a reason when unsupported', () => {
  const result = pickIsolationFlag('20.11.0');
  assert.equal(result.supported, false);
  assert.match(result.reason, /22\.8\.0/);
});
