import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as fx from '../src/math/fixed.ts';

function closeTo(actual: number, expected: number, epsilon: number, msg?: string) {
  assert.ok(Math.abs(actual - expected) <= epsilon, msg ?? `expected ${actual} close to ${expected} within ${epsilon}`);
}

describe('fixed-point: conversions', () => {
  it('fromInt/toInt round-trips', () => {
    assert.equal(fx.toInt(fx.fromInt(5)), 5);
    assert.equal(fx.toInt(fx.fromInt(-5)), -5);
    assert.equal(fx.toInt(fx.fromInt(0)), 0);
  });

  it('fromFloat/toFloat round-trips within Q16.16 precision', () => {
    closeTo(fx.toFloat(fx.fromFloat(3.25)), 3.25, 1e-4);
    closeTo(fx.toFloat(fx.fromFloat(-7.5)), -7.5, 1e-4);
  });

  it('ONE equals 1<<16', () => {
    assert.equal(fx.ONE, 65536);
    assert.equal(fx.toFloat(fx.ONE), 1);
  });
});

describe('fixed-point: add/sub', () => {
  it('adds and subtracts exactly', () => {
    const a = fx.fromInt(10);
    const b = fx.fromInt(3);
    assert.equal(fx.toInt(fx.add(a, b)), 13);
    assert.equal(fx.toInt(fx.sub(a, b)), 7);
  });

  it('handles negative operands', () => {
    const a = fx.fromInt(-4);
    const b = fx.fromInt(6);
    assert.equal(fx.toInt(fx.add(a, b)), 2);
    assert.equal(fx.toInt(fx.sub(a, b)), -10);
  });

  it('wraps on int32 overflow like other sim integer ops', () => {
    const big = 2147483647 | 0; // INT32_MAX
    const wrapped = fx.add(big, 1);
    assert.equal(wrapped, -2147483648); // wraps to INT32_MIN
  });
});

describe('fixed-point: mul/div', () => {
  it('multiplies exactly for simple integers', () => {
    assert.equal(fx.toInt(fx.mul(fx.fromInt(6), fx.fromInt(7))), 42);
  });

  it('multiplies fractional values without precision blowup', () => {
    closeTo(fx.toFloat(fx.mul(fx.fromFloat(0.5), fx.fromFloat(0.5))), 0.25, 1e-4);
  });

  it('divides exactly for simple integers', () => {
    assert.equal(fx.toInt(fx.div(fx.fromInt(42), fx.fromInt(6))), 7);
  });

  it('divides fractional and truncates toward zero', () => {
    closeTo(fx.toFloat(fx.div(fx.fromInt(7), fx.fromInt(2))), 3.5, 1e-4);
  });

  it('throws on division by zero', () => {
    assert.throws(() => fx.div(fx.fromInt(1), 0), RangeError);
  });

  it('mul does not silently lose precision for large operands', () => {
    // 0.001 itself only has ~15 bits of fractional precision in Q16.16
    // (fromFloat(0.001) rounds to the nearest 1/65536), so the expected
    // result is computed the same way mul() would see it, not the exact
    // mathematical product.
    const expected = fx.toFloat(fx.fromFloat(0.001)) * 30000;
    closeTo(fx.toFloat(fx.mul(fx.fromInt(30000), fx.fromFloat(0.001))), expected, 0.01);
  });
});

describe('fixed-point: sqrt', () => {
  it('sqrt(0) is 0', () => {
    assert.equal(fx.sqrt(0), 0);
  });

  it('sqrt of a perfect square integer', () => {
    closeTo(fx.toFloat(fx.sqrt(fx.fromInt(16))), 4, 1e-3);
    closeTo(fx.toFloat(fx.sqrt(fx.fromInt(81))), 9, 1e-3);
  });

  it('sqrt of a non-perfect-square integer', () => {
    closeTo(fx.toFloat(fx.sqrt(fx.fromInt(2))), Math.sqrt(2), 1e-2);
  });

  it('sqrt of a fractional value', () => {
    closeTo(fx.toFloat(fx.sqrt(fx.fromFloat(0.25))), 0.5, 1e-2);
  });

  it('throws on negative input', () => {
    assert.throws(() => fx.sqrt(fx.fromInt(-1)), RangeError);
  });
});

describe('fixed-point: clamp/min/max', () => {
  it('clamps within range', () => {
    assert.equal(fx.clamp(fx.fromInt(5), fx.fromInt(0), fx.fromInt(10)), fx.fromInt(5));
    assert.equal(fx.clamp(fx.fromInt(-5), fx.fromInt(0), fx.fromInt(10)), fx.fromInt(0));
    assert.equal(fx.clamp(fx.fromInt(15), fx.fromInt(0), fx.fromInt(10)), fx.fromInt(10));
  });

  it('min/max pick correctly including negatives', () => {
    assert.equal(fx.min(fx.fromInt(-3), fx.fromInt(2)), fx.fromInt(-3));
    assert.equal(fx.max(fx.fromInt(-3), fx.fromInt(2)), fx.fromInt(2));
  });
});

describe('fixed-point: trig LUT', () => {
  it('sin(0) == 0, cos(0) == ONE', () => {
    assert.equal(fx.sinLUT(0), 0);
    assert.equal(fx.cosLUT(0), fx.ONE);
  });

  it('sin at quarter turn ~= 1, cos ~= 0', () => {
    const quarter = fx.LUT_SIZE / 4;
    closeTo(fx.toFloat(fx.sinLUT(quarter)), 1, 1e-2);
    closeTo(fx.toFloat(fx.cosLUT(quarter)), 0, 1e-2);
  });

  it('wraps around for indices beyond LUT_SIZE (periodicity)', () => {
    assert.equal(fx.sinLUT(fx.LUT_SIZE), fx.sinLUT(0));
    assert.equal(fx.sinLUT(fx.LUT_SIZE + 5), fx.sinLUT(5));
    assert.equal(fx.sinLUT(-1), fx.sinLUT(fx.LUT_SIZE - 1));
  });

  it('handles large and negative indices without throwing', () => {
    assert.doesNotThrow(() => fx.sinLUT(1000000));
    assert.doesNotThrow(() => fx.sinLUT(-1000000));
  });

  it('matches Math.sin/cos closely at sample points (accuracy check, not a sim runtime dependency)', () => {
    for (const idx of [1, 10, 100, 500, 900]) {
      const angle = (2 * Math.PI * idx) / fx.LUT_SIZE;
      closeTo(fx.toFloat(fx.sinLUT(idx)), Math.sin(angle), 1e-2);
      closeTo(fx.toFloat(fx.cosLUT(idx)), Math.cos(angle), 1e-2);
    }
  });
});
