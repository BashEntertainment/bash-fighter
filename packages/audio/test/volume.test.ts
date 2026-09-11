// Regression tests for issue #14: a volume slider (0..1) independent of
// mute/unmute. computeEffectiveGain is the pure function AudioManager
// uses to set the master gain node's value, so it can be tested without
// a real AudioContext (same approach as hit-sound-params.test.ts).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { computeEffectiveGain } from '../src/index.ts';

describe('computeEffectiveGain: volume and mute are independent controls', () => {
  it('full volume, not muted, produces full gain', () => {
    assert.equal(computeEffectiveGain(false, 1), 1);
  });

  it('scales gain by the volume level when not muted', () => {
    assert.equal(computeEffectiveGain(false, 0.5), 0.5);
    assert.equal(computeEffectiveGain(false, 0.25), 0.25);
  });

  it('volume at 0 has the same audible effect as muting', () => {
    assert.equal(computeEffectiveGain(false, 0), 0);
    assert.equal(computeEffectiveGain(true, 1), 0);
  });

  it('muted always wins, regardless of volume level', () => {
    assert.equal(computeEffectiveGain(true, 0.8), 0);
    assert.equal(computeEffectiveGain(true, 1), 0);
  });

  it('clamps out-of-range volume to 0..1', () => {
    assert.equal(computeEffectiveGain(false, 1.5), 1);
    assert.equal(computeEffectiveGain(false, -0.5), 0);
  });
});
