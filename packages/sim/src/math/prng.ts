// Deterministic seeded PRNG: xorshift128+. Never use Math.random() in sim —
// every match seeds this once from a value exchanged pre-kickoff, so all
// clients derive an identical random sequence.
export interface RngState {
  s0: bigint;
  s1: bigint;
}

const MASK64 = (1n << 64n) - 1n;

function splitmix64(seed: bigint): () => bigint {
  let state = seed & MASK64;
  return () => {
    state = (state + 0x9e3779b97f4a7c15n) & MASK64;
    let z = state;
    z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & MASK64;
    z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & MASK64;
    z = z ^ (z >> 31n);
    return z & MASK64;
  };
}

/** Create RNG state from a 64-bit (or smaller) integer seed, using
 * splitmix64 to fill the two 64-bit xorshift128+ lanes so even small seeds
 * (e.g. 1, 2, 3) produce well-mixed, decorrelated initial state. */
export function seedRng(seed: number | bigint): RngState {
  const gen = splitmix64(BigInt(seed) & MASK64);
  const s0 = gen();
  let s1 = gen();
  if (s0 === 0n && s1 === 0n) {
    s1 = 1n; // xorshift128+ must never be seeded all-zero
  }
  return { s0, s1 };
}

/** Advance the RNG by one step, mutating-and-returning a NEW state object
 * (state objects are small; callers store the returned state). Returns the
 * raw next 64-bit output as a bigint in [0, 2^64). */
export function nextRaw(state: RngState): { value: bigint; state: RngState } {
  let s1 = state.s0;
  const s0 = state.s1;
  const result = (s0 + s1) & MASK64;
  s1 ^= (s1 << 23n) & MASK64;
  s1 ^= s1 >> 17n;
  s1 ^= s0;
  s1 ^= s0 >> 26n;
  return { value: result, state: { s0, s1 } };
}

/** Returns a uint32 in [0, 2^32) and the advanced state. */
export function nextUint32(state: RngState): { value: number; state: RngState } {
  const { value, state: next } = nextRaw(state);
  return { value: Number(value & 0xffffffffn), state: next };
}

/** Returns an integer in [0, bound) (bound must be a positive integer up to
 * 2^32) using the high bits of the raw output, and the advanced state. */
export function nextBounded(
  state: RngState,
  bound: number,
): { value: number; state: RngState } {
  if (!Number.isInteger(bound) || bound <= 0) {
    throw new RangeError('nextBounded: bound must be a positive integer');
  }
  const { value: raw, state: next } = nextRaw(state);
  const value = Number(raw % BigInt(bound));
  return { value, state: next };
}
