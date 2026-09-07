// Q16.16 fixed-point arithmetic. All sim state (position, velocity,
// knockback, percent) is represented as a Fixed (a 32-bit integer where the
// low 16 bits are the fractional part). No floats are used for sim state at
// runtime — only integer/BigInt math, so results are bitwise identical
// across browsers/CPUs. See wiki "Engine Architecture" section 2.
import { SIN_LUT, COS_LUT, LUT_SIZE } from './trigTable.ts';

export type Fixed = number;

export const FRAC_BITS = 16;
export const ONE: Fixed = 1 << FRAC_BITS;
export const ZERO: Fixed = 0;

const INT32_MIN = -2147483648;
const INT32_MAX = 2147483647;

/** Wrap a value into signed 32-bit range, matching JS `|0` semantics. */
function wrap32(n: number): Fixed {
  return n | 0;
}

export function fromInt(n: number): Fixed {
  return wrap32(n * ONE);
}

export function fromFloat(f: number): Fixed {
  return wrap32(Math.round(f * ONE));
}

export function toFloat(a: Fixed): number {
  return a / ONE;
}

export function toInt(a: Fixed): number {
  // Truncate toward zero, like C integer division.
  return a >= 0 ? Math.floor(a / ONE) : Math.ceil(a / ONE);
}

export function add(a: Fixed, b: Fixed): Fixed {
  return wrap32(a + b);
}

export function sub(a: Fixed, b: Fixed): Fixed {
  return wrap32(a - b);
}

export function neg(a: Fixed): Fixed {
  return wrap32(-a);
}

export function abs(a: Fixed): Fixed {
  return a < 0 ? neg(a) : a;
}

/** Multiply two Q16.16 values. Uses BigInt internally to avoid intermediate
 * precision loss, then wraps to 32-bit like the rest of this module. */
export function mul(a: Fixed, b: Fixed): Fixed {
  const r = (BigInt(a) * BigInt(b)) >> BigInt(FRAC_BITS);
  return wrap32(Number(BigInt.asIntN(32, r)));
}

/** Divide two Q16.16 values, truncating toward zero. Throws on division by
 * zero rather than returning Infinity/NaN, since that would not be a valid
 * Fixed value and NaN propagation is a common source of desyncs. */
export function div(a: Fixed, b: Fixed): Fixed {
  if (b === 0) {
    throw new RangeError('fixed.div: division by zero');
  }
  const num = BigInt(a) << BigInt(FRAC_BITS);
  const den = BigInt(b);
  const r = num / den; // BigInt division truncates toward zero
  return wrap32(Number(BigInt.asIntN(32, r)));
}

/** Integer square root of a Q16.16 value via Newton's method on BigInt.
 * sqrt(0) = 0. Throws on negative input (no imaginary results in sim). */
export function sqrt(a: Fixed): Fixed {
  if (a < 0) {
    throw new RangeError('fixed.sqrt: negative input');
  }
  if (a === 0) {
    return 0;
  }
  // We want result R (Q16.16) such that R/ONE ~= sqrt(a/ONE), i.e.
  // R = sqrt(a * ONE) in integer terms (extra ONE factor restores the scale
  // lost by taking a square root of a fixed-point number).
  const target = BigInt(a) << BigInt(FRAC_BITS);
  let x = target;
  if (x === 0n) return 0;
  // Initial guess: bit-length based, always >= true root, so Newton's
  // method converges monotonically downward without oscillation.
  let guess = 1n << BigInt((bitLength(target) + 1) >> 1);
  for (let i = 0; i < 64; i++) {
    const next = (guess + target / guess) / 2n;
    if (next >= guess) break;
    guess = next;
  }
  return wrap32(Number(BigInt.asIntN(32, guess)));
}

function bitLength(n: bigint): number {
  if (n <= 0n) return 0;
  let bits = 0;
  let v = n;
  while (v > 0n) {
    v >>= 1n;
    bits++;
  }
  return bits;
}

export function clamp(a: Fixed, min: Fixed, max: Fixed): Fixed {
  return a < min ? min : a > max ? max : a;
}

export function min(a: Fixed, b: Fixed): Fixed {
  return a < b ? a : b;
}

export function max(a: Fixed, b: Fixed): Fixed {
  return a > b ? a : b;
}

// --- Trig via precomputed LUT (see trigTable.ts, generated offline) -------

/** Normalize an arbitrary integer LUT index into [0, LUT_SIZE). */
function wrapIndex(idx: number): number {
  const m = idx % LUT_SIZE;
  return m < 0 ? m + LUT_SIZE : m;
}

/** angleIdx is an integer in [0, LUT_SIZE) representing a fraction of a full
 * turn (0 = 0 rad, LUT_SIZE/4 = pi/2, ...). Any integer is accepted and
 * wrapped, so callers can accumulate angle indices without pre-normalizing. */
export function sinLUT(angleIdx: number): Fixed {
  return SIN_LUT[wrapIndex(angleIdx)] as number;
}

export function cosLUT(angleIdx: number): Fixed {
  return COS_LUT[wrapIndex(angleIdx)] as number;
}

export { LUT_SIZE };

export const INT32_RANGE = { INT32_MIN, INT32_MAX };
