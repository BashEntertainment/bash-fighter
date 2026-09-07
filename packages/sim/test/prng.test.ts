import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { seedRng, nextRaw, nextUint32, nextBounded } from '../src/math/prng.ts';

describe('seeded PRNG determinism', () => {
  it('a fixed seed produces a fixed known sequence of raw values', () => {
    let state = seedRng(42);
    const seq: string[] = [];
    for (let i = 0; i < 5; i++) {
      const r = nextRaw(state);
      seq.push(r.value.toString(16));
      state = r.state;
    }
    // Golden sequence for seed=42, captured once from this implementation
    // and pinned here so any change to the algorithm is caught as a
    // determinism break, not silently shipped.
    assert.deepEqual(seq, [
      'e6c71559e2525f98',
      'af1f56fc41a4d2d2',
      'bd496f01ee605ceb',
      '8c8b2271e69fdbf6',
      '5438402ac6921e50',
    ]);
  });

  it('same seed always produces the same sequence', () => {
    const run = (seed: number) => {
      let state = seedRng(seed);
      const out: number[] = [];
      for (let i = 0; i < 10; i++) {
        const r = nextUint32(state);
        out.push(r.value);
        state = r.state;
      }
      return out;
    };
    assert.deepEqual(run(1234), run(1234));
  });

  it('different seeds produce different sequences', () => {
    const first = nextUint32(seedRng(1)).value;
    const second = nextUint32(seedRng(2)).value;
    assert.notEqual(first, second);
  });

  it('never seeds all-zero internal state (seed 0 case)', () => {
    const state = seedRng(0);
    assert.ok(state.s0 !== 0n || state.s1 !== 0n);
  });

  it('nextBounded stays within [0, bound) over many draws', () => {
    let state = seedRng(7);
    for (let i = 0; i < 500; i++) {
      const r = nextBounded(state, 37);
      assert.ok(r.value >= 0);
      assert.ok(r.value < 37);
      state = r.state;
    }
  });

  it('nextBounded rejects a non-positive-integer bound', () => {
    const state = seedRng(1);
    assert.throws(() => nextBounded(state, 0), RangeError);
    assert.throws(() => nextBounded(state, -3), RangeError);
  });
});
