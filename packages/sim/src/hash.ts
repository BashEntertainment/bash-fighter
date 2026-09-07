// Deterministic hash of a serialized StateBuffer for the determinism CI
// test (Engine Architecture §2). Pure integer FNV-1a, 64-bit, implemented
// with BigInt so it runs identically in Node and the browser — no
// node:crypto dependency, since this module ships to the browser too.
import type { StateBuffer } from './sim.ts';

const FNV_OFFSET_BASIS = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;
const MASK64 = (1n << 64n) - 1n;

/** Hash a StateBuffer's bytes, returned as a lowercase hex string (16 chars
 * for a 64-bit hash), independent of host endianness since we read each
 * Int32 explicitly instead of viewing the buffer as raw bytes. */
export function hashStateBuffer(buf: StateBuffer): string {
  let h = FNV_OFFSET_BASIS;
  for (let i = 0; i < buf.length; i++) {
    const word = (buf[i] as number) | 0;
    // Feed 4 bytes (big-endian) of this 32-bit word through FNV-1a.
    for (let shift = 24; shift >= 0; shift -= 8) {
      const byte = BigInt((word >>> shift) & 0xff);
      h ^= byte;
      h = (h * FNV_PRIME) & MASK64;
    }
  }
  return h.toString(16).padStart(16, '0');
}
