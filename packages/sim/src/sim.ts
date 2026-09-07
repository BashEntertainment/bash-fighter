// Minimal deterministic simulation core: two fighters, gravity, ground
// collision against one flat platform, jump, horizontal movement — no
// attacks yet (that is explicitly out of scope for this milestone).
//
// Hot path (advance()) touches only preallocated typed arrays: no `new`,
// no array growth, no Map/Set. This is the GGPO-rollback contract from
// "Engine Architecture: Input, Netplay, and Content Pipeline" §6.
import * as fx from './math/fixed.ts';
import type { Fixed } from './math/fixed.ts';
import { FighterStateId, type FighterStateValue } from './entities/fighter.ts';
import { BUTTON_JUMP, type InputFrame } from './types.ts';
import { seedRng, nextUint32, type RngState } from './math/prng.ts';

export const NUM_FIGHTERS = 2;

// --- Tunables (Q16.16), later replaced by real tuning constants ----------
export const GRAVITY: Fixed = fx.fromFloat(-0.85);
export const GROUND_Y: Fixed = fx.fromInt(0);
export const JUMP_VELOCITY: Fixed = fx.fromFloat(14.0);
export const MOVE_SPEED: Fixed = fx.fromFloat(4.5);
export const TERMINAL_VELOCITY: Fixed = fx.fromFloat(-20.0);
// Flat platform stage bounds — fighters are clamped to it (no falling off
// the sides in this minimal model; blast zones come later per the doc).
export const STAGE_MIN_X: Fixed = fx.fromInt(-200);
export const STAGE_MAX_X: Fixed = fx.fromInt(200);

/** Layout of one fighter's slice inside the flat Int32Array state buffer. */
const FighterField = {
  POS_X: 0,
  POS_Y: 1,
  VEL_X: 2,
  VEL_Y: 3,
  STATE: 4,
  FACING: 5, // 1 or -1
  GROUNDED: 6, // 0 or 1
  FIELD_COUNT: 7,
} as const;

const RNG_WORDS = 2; // s0, s1 each stored as two 32-bit halves -> 4 words total
const RNG_FIELD_WORDS = 4;
const TICK_WORDS = 1;

const STATE_WORDS =
  NUM_FIGHTERS * FighterField.FIELD_COUNT + RNG_FIELD_WORDS + TICK_WORDS;

/** Opaque, preallocated snapshot of full sim state. Plain Int32Array so it
 * is cheap to copy (TypedArray.set) and trivial to hash for the determinism
 * test. Never resized after creation. */
export type StateBuffer = Int32Array;

function bigintToWords(b: bigint): [number, number] {
  const lo = Number(b & 0xffffffffn) | 0;
  const hi = Number((b >> 32n) & 0xffffffffn) | 0;
  return [lo, hi];
}

function wordsToBigint(lo: number, hi: number): bigint {
  const loU = BigInt(lo >>> 0);
  const hiU = BigInt(hi >>> 0);
  return (hiU << 32n) | loU;
}

export interface FighterSnapshot {
  posX: Fixed;
  posY: Fixed;
  velX: Fixed;
  velY: Fixed;
  state: FighterStateValue;
  facing: 1 | -1;
  grounded: boolean;
}

export class Sim {
  // Preallocated hot-path state. Never reassigned after construction.
  private readonly data: Int32Array;
  private rng: RngState;
  private tick = 0;

  constructor(seed: number | bigint) {
    this.data = new Int32Array(STATE_WORDS);
    this.rng = seedRng(seed);
    this.resetFighter(0, fx.fromInt(-30));
    this.resetFighter(1, fx.fromInt(30));
  }

  private resetFighter(index: number, startX: Fixed): void {
    const base = index * FighterField.FIELD_COUNT;
    this.data[base + FighterField.POS_X] = startX;
    this.data[base + FighterField.POS_Y] = GROUND_Y;
    this.data[base + FighterField.VEL_X] = 0;
    this.data[base + FighterField.VEL_Y] = 0;
    this.data[base + FighterField.STATE] = FighterStateId.IDLE;
    this.data[base + FighterField.FACING] = index === 0 ? 1 : -1;
    this.data[base + FighterField.GROUNDED] = 1;
  }

  getTick(): number {
    return this.tick;
  }

  getFighter(index: number): FighterSnapshot {
    if (index < 0 || index >= NUM_FIGHTERS) {
      throw new RangeError(`getFighter: index out of range: ${index}`);
    }
    const base = index * FighterField.FIELD_COUNT;
    const d = this.data;
    return {
      posX: d[base + FighterField.POS_X] as number,
      posY: d[base + FighterField.POS_Y] as number,
      velX: d[base + FighterField.VEL_X] as number,
      velY: d[base + FighterField.VEL_Y] as number,
      state: d[base + FighterField.STATE] as FighterStateValue,
      facing: (d[base + FighterField.FACING] as number) < 0 ? -1 : 1,
      grounded: (d[base + FighterField.GROUNDED] as number) !== 0,
    };
  }

  /** Allocate a StateBuffer sized for this sim. Call once at match setup /
   * whenever a rollback buffer pool is being built — never inside the hot
   * per-tick loop. */
  createStateBuffer(): StateBuffer {
    return new Int32Array(STATE_WORDS);
  }

  /** Copy current sim state into `buf` (no allocation). */
  saveState(buf: StateBuffer): void {
    if (buf.length !== STATE_WORDS) {
      throw new RangeError('saveState: buffer size mismatch');
    }
    buf.set(this.data);
    const fighterWords = NUM_FIGHTERS * FighterField.FIELD_COUNT;
    const [s0lo, s0hi] = bigintToWords(this.rng.s0);
    const [s1lo, s1hi] = bigintToWords(this.rng.s1);
    buf[fighterWords + 0] = s0lo;
    buf[fighterWords + 1] = s0hi;
    buf[fighterWords + 2] = s1lo;
    buf[fighterWords + 3] = s1hi;
    buf[fighterWords + RNG_FIELD_WORDS] = this.tick;
  }

  /** Restore sim state from a previously saved buffer (no allocation). */
  loadState(buf: StateBuffer): void {
    if (buf.length !== STATE_WORDS) {
      throw new RangeError('loadState: buffer size mismatch');
    }
    this.data.set(buf);
    const fighterWords = NUM_FIGHTERS * FighterField.FIELD_COUNT;
    const s0 = wordsToBigint(buf[fighterWords + 0] as number, buf[fighterWords + 1] as number);
    const s1 = wordsToBigint(buf[fighterWords + 2] as number, buf[fighterWords + 3] as number);
    this.rng = { s0, s1 };
    this.tick = buf[fighterWords + RNG_FIELD_WORDS] as number;
  }

  /** Advance the sim by exactly one fixed 60Hz tick. Must not allocate. */
  advance(inputs: readonly InputFrame[]): void {
    if (inputs.length !== NUM_FIGHTERS) {
      throw new RangeError(`advance: expected ${NUM_FIGHTERS} inputs, got ${inputs.length}`);
    }
    for (let i = 0; i < NUM_FIGHTERS; i++) {
      this.stepFighter(i, inputs[i] as InputFrame);
    }
    // Draw one RNG value per tick so PRNG progression is itself part of the
    // deterministic, hashable state (exercises the RNG in the hot path
    // without affecting movement yet — future hit-chance/DI rolls hook here).
    const { value, state } = nextUint32(this.rng);
    this.rng = state;
    void value;
    this.tick = (this.tick + 1) | 0;
  }

  private stepFighter(index: number, input: InputFrame): void {
    const base = index * FighterField.FIELD_COUNT;
    const d = this.data;

    let velX = d[base + FighterField.VEL_X] as number;
    let velY = d[base + FighterField.VEL_Y] as number;
    let posX = d[base + FighterField.POS_X] as number;
    let posY = d[base + FighterField.POS_Y] as number;
    let grounded = (d[base + FighterField.GROUNDED] as number) !== 0;
    let facing = d[base + FighterField.FACING] as number;

    // Horizontal movement: direct velocity control from the stick, no
    // acceleration/friction modeling yet.
    velX = fx.mul(input.stickX, MOVE_SPEED);
    if (velX > 0) facing = 1;
    else if (velX < 0) facing = -1;

    // Jump.
    if (grounded && (input.buttons & BUTTON_JUMP) !== 0) {
      velY = JUMP_VELOCITY;
      grounded = false;
    }

    // Gravity, only while airborne.
    if (!grounded) {
      velY = fx.add(velY, GRAVITY);
      velY = fx.max(velY, TERMINAL_VELOCITY);
    }

    posX = fx.add(posX, velX);
    posX = fx.clamp(posX, STAGE_MIN_X, STAGE_MAX_X);
    posY = fx.add(posY, velY);

    // Ground collision against the single flat platform at GROUND_Y.
    if (posY <= GROUND_Y) {
      posY = GROUND_Y;
      velY = 0;
      grounded = true;
    }

    const state: FighterStateValue = grounded
      ? velX !== 0
        ? FighterStateId.RUN
        : FighterStateId.IDLE
      : FighterStateId.AIRBORNE;

    d[base + FighterField.POS_X] = posX;
    d[base + FighterField.POS_Y] = posY;
    d[base + FighterField.VEL_X] = velX;
    d[base + FighterField.VEL_Y] = velY;
    d[base + FighterField.STATE] = state;
    d[base + FighterField.FACING] = facing;
    d[base + FighterField.GROUNDED] = grounded ? 1 : 0;
  }
}
