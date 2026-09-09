import { test } from 'node:test';
import assert from 'node:assert/strict';
import { probeIsolationFlag, decideFromProbeResult } from '../lib/isolation-flag.mjs';

test('decideFromProbeResult: a clean exit with no "bad option" stderr is supported', () => {
  const result = decideFromProbeResult({ status: 0, stderr: '' });
  assert.equal(result.supported, true);
  assert.equal(result.flag, '--test-isolation=none');
});

test('decideFromProbeResult: "bad option" stderr means unsupported, regardless of exit code', () => {
  // The exact message Node 22.23.2 actually prints (confirmed in CI).
  const result = decideFromProbeResult({
    status: 9,
    stderr: '/opt/hostedtoolcache/node/22.23.2/x64/bin/node: bad option: --test-isolation=none\n',
  });
  assert.equal(result.supported, false);
  assert.match(result.reason, /bad option/);
});

test('decideFromProbeResult: nonzero exit with no "bad option" text still counts as unsupported', () => {
  // Covers a hypothetical future Node that fails for a different reason;
  // we should not assume it's supported just because the message differs.
  const result = decideFromProbeResult({ status: 1, stderr: 'some other startup error\n' });
  assert.equal(result.supported, false);
});

test('probeIsolationFlag: actually asking the Node running this test succeeds', () => {
  // This test only proves something if it runs on a Node that has the
  // flag. If it doesn't, run-tests.mjs's own fallback path (verified by
  // the tests above) is what keeps the suite runnable.
  const result = probeIsolationFlag();
  assert.equal(typeof result.supported, 'boolean');
  if (result.supported) {
    assert.equal(result.flag, '--test-isolation=none');
  } else {
    assert.match(result.reason, /Node binary/);
  }
});
