// Deterministic simulation core: two fighters, gravity, ground collision
// against one flat platform, jump/movement, a declarative state machine,
// frame-data-driven attacks with hitbox/hurtbox resolution, percent +
// knockback + hitstun, shielding, and stocks/blast zones.
//
// Hot path (advance()) touches only preallocated typed arrays: no `new`,
// no array growth, no Map/Set. This is the GGPO-rollback contract from
// "Engine Architecture: Input, Netplay, and Content Pipeline" section 6.
import * as fx from './math/fixed.ts';
import type { Fixed } from './math/fixed.ts';
import { FighterStateId, type FighterStateValue } from './entities/fighter.ts';
import { assertTransition } from './state-machine/transitions.ts';
import { BUTTON_JUMP, BUTTON_ATTACK, BUTTON_SHIELD, type InputFrame } from './types.ts';
import { seedRng, nextUint32, type RngState } from './math/prng.ts';
import type { CharacterData, MoveDef } from './moves/types.ts';
import { MoveId, findMove, moveTotalDuration, windowAtFrame } from './moves/types.ts';
import { makeBoxCentered, aabbOverlap } from './hitbox.ts';
import {
  computeKnockbackMagnitude,
  computeHitstunTicks,
  mirrorAngleIdx,
} from './knockback.ts';
import { sinLUT, cosLUT } from './math/fixed.ts';

export const NUM_FIGHTERS = 2;

// --- Tunables (Q16.16), later replaced by real tuning constants ----------
export const GRAVITY: Fixed = fx.fromFloat(-0.85);
export const GROUND_Y: Fixed = fx.fromInt(0);
export const JUMP_VELOCITY: Fixed = fx.fromFloat(14.0);
export const MOVE_SPEED: Fixed = fx.fromFloat(4.5);
export const TERMINAL_VELOCITY: Fixed = fx.fromFloat(-20.0);
// Flat platform stage bounds, kept only to describe the platform surface
// fighters stand on; blast zones (below) are what now bounds the match.
export const STAGE_MIN_X: Fixed = fx.fromInt(-200);
export const STAGE_MAX_X: Fixed = fx.fromInt(200);
// Blast zone: crossing this rectangle costs a stock. Comfortably outside
// the stage platform so normal movement/knockback near the ledges is safe.
export const BLAST_MIN_X: Fixed = fx.fromInt(-260);
export const BLAST_MAX_X: Fixed = fx.fromInt(260);
export const BLAST_MIN_Y: Fixed = fx.fromInt(-120);
export const BLAST_MAX_Y: Fixed = fx.fromInt(220);

// Directional influence, applied per-tick while in hitstun (not as one
// instantaneous nudge): a small acceleration toward the held stick each
// tick, small enough relative to typical knockback magnitudes (see
// knockback.ts) that it curves the trajectory rather than letting the
// defender cancel or reverse it outright.
export const HITSTUN_DI_ACCEL_PER_TICK: Fixed = fx.fromFloat(0.06);
// Ground friction while sliding during hitstun (e.g. a bounce that lands
// mid-knockback): horizontal speed decays geometrically instead of holding
// constant forever.
export const GROUND_FRICTION: Fixed = fx.fromFloat(0.9);

export const STARTING_STOCKS = 3;
export const SHIELD_MAX_HEALTH: Fixed = fx.fromInt(100);
// Shield health lost per point of damage a shielded hit would have dealt.
export const SHIELD_DAMAGE_MULTIPLIER: Fixed = fx.fromFloat(1.2);
// Ticks of shieldstun per point of damage absorbed by the shield.
export const SHIELD_STUN_PER_DAMAGE: Fixed = fx.fromFloat(1.0);
export const SHIELD_BREAK_HITSTUN_TICKS = 120;

/** Layout of one fighter's slice inside the flat Int32Array state buffer. */
const FighterField = {
  POS_X: 0,
  POS_Y: 1,
  VEL_X: 2,
  VEL_Y: 3,
  STATE: 4,
  FACING: 5, // 1 or -1
  GROUNDED: 6, // 0 or 1
  MOVE_ID: 7, // -1 when not attacking
  MOVE_FRAME: 8, // ticks since the current move activation started
  MOVE_INSTANCE: 9, // monotonic per-fighter counter, bumped each move start
  PERCENT: 10, // Fixed
  STOCKS: 11,
  SHIELD_HEALTH: 12, // Fixed
  SHIELD_STUN: 13, // ticks remaining, cannot act
  HITSTUN: 14, // ticks remaining, cannot act
  LAST_HIT_FROM_0: 15, // MOVE_INSTANCE of fighter 0's move that last hit us (dedup)
  LAST_HIT_FROM_1: 16, // same, from fighter 1
  FIELD_COUNT: 17,
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
  moveId: number; // -1 when not attacking
  moveFrame: number;
  percent: Fixed;
  stocks: number;
  shieldHealth: Fixed;
  shieldStun: number;
  hitstun: number;
}

// A character with no moves: attack input is simply a no-op. Used as the
// default so packages/sim never needs to import packages/content (the
// content -> sim data dependency runs one way, per the design docs); a
// caller that wants real attacks passes CharacterData from packages/content.
const DEFAULT_CHARACTER: CharacterData = {
  name: 'Unnamed',
  weight: fx.fromInt(100),
  hurtboxWidth: fx.fromFloat(1.6),
  hurtboxHeight: fx.fromFloat(3.2),
  moves: [],
};

const SPAWN_X: readonly Fixed[] = [fx.fromInt(-30), fx.fromInt(30)];

/** True while `posX` is over the stage's solid platform. Ground collision
 * only applies here; past the platform edge there is nothing to land on,
 * which is what lets a hard knockback (including straight down) carry a
 * fighter through to the blast zone instead of bouncing off y=0. */
function onPlatform(posX: Fixed): boolean {
  return posX >= STAGE_MIN_X && posX <= STAGE_MAX_X;
}
const STICK_MOVE_THRESHOLD: Fixed = fx.fromFloat(0.5);

export class Sim {
  // Preallocated hot-path state. Never reassigned after construction.
  private readonly data: Int32Array;
  private rng: RngState;
  private tick = 0;
  private readonly characters: readonly [CharacterData, CharacterData];

  constructor(
    seed: number | bigint,
    characters: readonly [CharacterData, CharacterData] = [DEFAULT_CHARACTER, DEFAULT_CHARACTER],
  ) {
    this.data = new Int32Array(STATE_WORDS);
    this.rng = seedRng(seed);
    this.characters = characters;
    this.resetFighterForNewStock(0, true);
    this.resetFighterForNewStock(1, true);
  }

  /** Full reset for match start (fullLife) or respawn after a stock loss
   * (fullLife=false keeps stocks as already decremented by the caller). */
  private resetFighterForNewStock(index: number, fullLife: boolean): void {
    const base = index * FighterField.FIELD_COUNT;
    const d = this.data;
    d[base + FighterField.POS_X] = SPAWN_X[index] as number;
    d[base + FighterField.POS_Y] = GROUND_Y;
    d[base + FighterField.VEL_X] = 0;
    d[base + FighterField.VEL_Y] = 0;
    d[base + FighterField.STATE] = FighterStateId.IDLE;
    d[base + FighterField.FACING] = index === 0 ? 1 : -1;
    d[base + FighterField.GROUNDED] = 1;
    d[base + FighterField.MOVE_ID] = -1;
    d[base + FighterField.MOVE_FRAME] = 0;
    d[base + FighterField.PERCENT] = 0;
    d[base + FighterField.SHIELD_HEALTH] = SHIELD_MAX_HEALTH;
    d[base + FighterField.SHIELD_STUN] = 0;
    d[base + FighterField.HITSTUN] = 0;
    if (fullLife) {
      d[base + FighterField.STOCKS] = STARTING_STOCKS;
      d[base + FighterField.MOVE_INSTANCE] = 0;
      d[base + FighterField.LAST_HIT_FROM_0] = -1;
      d[base + FighterField.LAST_HIT_FROM_1] = -1;
    }
  }

  getTick(): number {
    return this.tick;
  }

  /** Index of the fighter with stocks remaining, or null if the match is
   * still ongoing (both have stocks) or ended in a simultaneous double-KO
   * (neither does). */
  getWinner(): number | null {
    const alive: number[] = [];
    for (let i = 0; i < NUM_FIGHTERS; i++) {
      const base = i * FighterField.FIELD_COUNT;
      if ((this.data[base + FighterField.STOCKS] as number) > 0) alive.push(i);
    }
    if (alive.length === 1) return alive[0] as number;
    return null;
  }

  isMatchOver(): boolean {
    let aliveCount = 0;
    for (let i = 0; i < NUM_FIGHTERS; i++) {
      const base = i * FighterField.FIELD_COUNT;
      if ((this.data[base + FighterField.STOCKS] as number) > 0) aliveCount++;
    }
    return aliveCount <= 1;
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
      moveId: d[base + FighterField.MOVE_ID] as number,
      moveFrame: d[base + FighterField.MOVE_FRAME] as number,
      percent: d[base + FighterField.PERCENT] as number,
      stocks: d[base + FighterField.STOCKS] as number,
      shieldHealth: d[base + FighterField.SHIELD_HEALTH] as number,
      shieldStun: d[base + FighterField.SHIELD_STUN] as number,
      hitstun: d[base + FighterField.HITSTUN] as number,
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
    // Hit resolution runs after movement, in fixed fighter-index order (never
    // Map/Set iteration order), so it is deterministic regardless of who is
    // "first" in wall-clock terms.
    for (let attacker = 0; attacker < NUM_FIGHTERS; attacker++) {
      const defender = attacker === 0 ? 1 : 0;
      this.resolveHits(attacker, defender, inputs[defender] as InputFrame);
    }
    for (let i = 0; i < NUM_FIGHTERS; i++) {
      this.checkBlastZone(i);
    }
    // Draw one RNG value per tick so PRNG progression is itself part of the
    // deterministic, hashable state (exercises the RNG in the hot path
    // without affecting movement yet — future hit-chance rolls hook here).
    const { value, state } = nextUint32(this.rng);
    this.rng = state;
    void value;
    this.tick = (this.tick + 1) | 0;
  }

  private setState(base: number, next: FighterStateValue): void {
    const current = this.data[base + FighterField.STATE] as FighterStateValue;
    assertTransition(current, next);
    this.data[base + FighterField.STATE] = next;
  }

  private startMove(index: number, base: number, moveId: number): void {
    const d = this.data;
    const nextInstance = ((d[base + FighterField.MOVE_INSTANCE] as number) + 1) | 0;
    d[base + FighterField.MOVE_ID] = moveId;
    d[base + FighterField.MOVE_FRAME] = 0;
    d[base + FighterField.MOVE_INSTANCE] = nextInstance;
    this.setState(base, FighterStateId.ATTACK);
    void index;
  }

  private stepFighter(index: number, input: InputFrame): void {
    const base = index * FighterField.FIELD_COUNT;
    const d = this.data;
    const state = d[base + FighterField.STATE] as FighterStateValue;

    if (state === FighterStateId.DEAD) {
      // No physics, no input, no timers: a dead fighter waits for the match
      // to be reported over. (Respawn logic — infinite stocks / re-entering
      // play — is out of scope: reaching 0 stocks ends that fighter's part
      // in the match per the design doc.)
      return;
    }

    let velX = d[base + FighterField.VEL_X] as number;
    let velY = d[base + FighterField.VEL_Y] as number;
    let posX = d[base + FighterField.POS_X] as number;
    let posY = d[base + FighterField.POS_Y] as number;
    let grounded = (d[base + FighterField.GROUNDED] as number) !== 0;
    let facing = d[base + FighterField.FACING] as number;
    let hitstun = d[base + FighterField.HITSTUN] as number;
    let shieldStun = d[base + FighterField.SHIELD_STUN] as number;
    let moveId = d[base + FighterField.MOVE_ID] as number;
    let moveFrame = d[base + FighterField.MOVE_FRAME] as number;

    const character = this.characters[index] as CharacterData;

    if (hitstun > 0) {
      // No voluntary control over movement, but the stick still curves the
      // knockback trajectory (directional influence) a little every tick,
      // and ground friction bleeds off horizontal speed if a bounce lands
      // the fighter back on the platform mid-hitstun.
      velX = fx.add(velX, fx.mul(input.stickX, HITSTUN_DI_ACCEL_PER_TICK));
      velY = fx.add(velY, fx.mul(input.stickY, HITSTUN_DI_ACCEL_PER_TICK));
      if (grounded) {
        velX = fx.mul(velX, GROUND_FRICTION);
      } else {
        velY = fx.add(velY, GRAVITY);
        velY = fx.max(velY, TERMINAL_VELOCITY);
      }
      posX = fx.add(posX, velX);
      posY = fx.add(posY, velY);
      // A launched fighter is only caught by the stage floor while inside
      // the platform's horizontal extent. Off the side of the stage there
      // is no floor to land on, so a strong downward (meteor) hit keeps
      // falling toward the bottom blast zone instead of snapping back to
      // y=0 the instant it crosses it.
      if (onPlatform(posX) && posY <= GROUND_Y && velY <= 0) {
        posY = GROUND_Y;
        velY = 0;
        grounded = true;
      } else {
        grounded = false;
      }
      hitstun = (hitstun - 1) | 0;
      if (hitstun === 0) {
        this.setState(base, grounded ? FighterStateId.IDLE : FighterStateId.AIRBORNE);
      }
      this.writeBack(base, { posX, posY, velX, velY, grounded, facing, moveId: -1, moveFrame: 0, hitstun, shieldStun });
      return;
    }

    if (shieldStun > 0) {
      // Frozen in place while the shield absorbs stun; no movement at all.
      shieldStun = (shieldStun - 1) | 0;
      if (shieldStun === 0) {
        this.setState(base, FighterStateId.IDLE);
      }
      this.writeBack(base, { posX, posY, velX: 0, velY: 0, grounded, facing, moveId: -1, moveFrame: 0, hitstun, shieldStun });
      return;
    }

    if (state === FighterStateId.SHIELD) {
      if ((input.buttons & BUTTON_SHIELD) !== 0) {
        this.writeBack(base, { posX, posY, velX: 0, velY: 0, grounded, facing, moveId: -1, moveFrame: 0, hitstun, shieldStun });
        return;
      }
      this.setState(base, FighterStateId.IDLE);
      // fall through to normal movement handling below this tick.
    }

    if (state === FighterStateId.ATTACK) {
      const move = findMove(character, moveId as never);
      const total = move ? moveTotalDuration(move) : 0;
      moveFrame = (moveFrame + 1) | 0;
      // Attacks lock horizontal drift but still obey gravity in the air.
      if (!grounded) {
        velY = fx.add(velY, GRAVITY);
        velY = fx.max(velY, TERMINAL_VELOCITY);
      } else {
        velX = 0;
      }
      posX = fx.add(posX, velX);
      posX = fx.clamp(posX, STAGE_MIN_X, STAGE_MAX_X);
      posY = fx.add(posY, velY);
      if (posY <= GROUND_Y) {
        posY = GROUND_Y;
        velY = 0;
        grounded = true;
      } else {
        grounded = false;
      }
      if (moveFrame >= total) {
        moveId = -1;
        moveFrame = 0;
        this.setState(base, grounded ? (velX !== 0 ? FighterStateId.RUN : FighterStateId.IDLE) : FighterStateId.AIRBORNE);
      }
      this.writeBack(base, { posX, posY, velX, velY, grounded, facing, moveId, moveFrame, hitstun, shieldStun });
      return;
    }

    // --- Normal (idle/run/jump/airborne) movement + move-start triggers ---
    const wantsShield = (input.buttons & BUTTON_SHIELD) !== 0;
    if (grounded && wantsShield) {
      velX = 0;
      this.setState(base, FighterStateId.SHIELD);
      this.writeBack(base, { posX, posY, velX: 0, velY: 0, grounded, facing, moveId: -1, moveFrame: 0, hitstun, shieldStun });
      return;
    }

    const wantsAttack = (input.buttons & BUTTON_ATTACK) !== 0;
    if (wantsAttack && character.moves.length > 0) {
      let chosen: number;
      if (grounded) {
        chosen = fx.abs(input.stickX) > STICK_MOVE_THRESHOLD ? MoveId.FTILT : MoveId.JAB;
      } else {
        chosen = input.stickY < fx.neg(STICK_MOVE_THRESHOLD) ? MoveId.DAIR : MoveId.UAIR;
      }
      if (findMove(character, chosen)) {
        this.startMove(index, base, chosen);
        this.writeBack(base, { posX, posY, velX: 0, velY, grounded, facing, moveId: chosen, moveFrame: 0, hitstun, shieldStun });
        return;
      }
    }

    velX = fx.mul(input.stickX, MOVE_SPEED);
    if (velX > 0) facing = 1;
    else if (velX < 0) facing = -1;

    if (grounded && (input.buttons & BUTTON_JUMP) !== 0) {
      velY = JUMP_VELOCITY;
      grounded = false;
    }

    if (!grounded) {
      velY = fx.add(velY, GRAVITY);
      velY = fx.max(velY, TERMINAL_VELOCITY);
    }

    posX = fx.add(posX, velX);
    posX = fx.clamp(posX, STAGE_MIN_X, STAGE_MAX_X);
    posY = fx.add(posY, velY);

    if (posY <= GROUND_Y) {
      posY = GROUND_Y;
      velY = 0;
      grounded = true;
    }

    const nextState: FighterStateValue = grounded
      ? velX !== 0
        ? FighterStateId.RUN
        : FighterStateId.IDLE
      : FighterStateId.AIRBORNE;
    this.setState(base, nextState);

    this.writeBack(base, { posX, posY, velX, velY, grounded, facing, moveId: -1, moveFrame: 0, hitstun, shieldStun });
  }

  private writeBack(
    base: number,
    v: {
      posX: Fixed;
      posY: Fixed;
      velX: Fixed;
      velY: Fixed;
      grounded: boolean;
      facing: number;
      moveId: number;
      moveFrame: number;
      hitstun: number;
      shieldStun: number;
    },
  ): void {
    const d = this.data;
    d[base + FighterField.POS_X] = v.posX;
    d[base + FighterField.POS_Y] = v.posY;
    d[base + FighterField.VEL_X] = v.velX;
    d[base + FighterField.VEL_Y] = v.velY;
    d[base + FighterField.GROUNDED] = v.grounded ? 1 : 0;
    d[base + FighterField.FACING] = v.facing;
    d[base + FighterField.MOVE_ID] = v.moveId;
    d[base + FighterField.MOVE_FRAME] = v.moveFrame;
    d[base + FighterField.HITSTUN] = v.hitstun;
    d[base + FighterField.SHIELD_STUN] = v.shieldStun;
  }

  /** For fighter `attacker` currently in the ATTACK state, find its active
   * window's hitboxes (if any) and resolve overlap against `defender`'s
   * hurtbox. One hit per target per move activation, enforced via the
   * MOVE_INSTANCE / LAST_HIT_FROM_* hit-ID system. */
  private resolveHits(attacker: number, defender: number, defenderInput: InputFrame): void {
    const d = this.data;
    const aBase = attacker * FighterField.FIELD_COUNT;
    const dBase = defender * FighterField.FIELD_COUNT;

    if ((d[aBase + FighterField.STATE] as number) !== FighterStateId.ATTACK) return;
    if ((d[dBase + FighterField.STATE] as number) === FighterStateId.DEAD) return;

    const attackerChar = this.characters[attacker] as CharacterData;
    const moveId = d[aBase + FighterField.MOVE_ID] as number;
    const move = findMove(attackerChar, moveId as never) as MoveDef | undefined;
    if (!move) return;
    const moveFrame = d[aBase + FighterField.MOVE_FRAME] as number;
    // moveFrame was already incremented for *this* tick in stepFighter, so
    // the window we just finished executing is (moveFrame - 1).
    const located = windowAtFrame(move, moveFrame - 1);
    if (!located || located.window.kind !== 'active' || located.window.hitboxes.length === 0) return;

    const attackerFacing = d[aBase + FighterField.FACING] as number;
    const attackerX = d[aBase + FighterField.POS_X] as number;
    const attackerY = d[aBase + FighterField.POS_Y] as number;
    const defenderChar = this.characters[defender] as CharacterData;
    const defenderX = d[dBase + FighterField.POS_X] as number;
    const defenderY = d[dBase + FighterField.POS_Y] as number;
    const defenderBox = makeBoxCentered(defenderX, defenderY, defenderChar.hurtboxWidth, defenderChar.hurtboxHeight);

    const moveInstance = d[aBase + FighterField.MOVE_INSTANCE] as number;
    const lastHitField = attacker === 0 ? FighterField.LAST_HIT_FROM_0 : FighterField.LAST_HIT_FROM_1;
    if ((d[dBase + lastHitField] as number) === moveInstance) return; // already hit this activation

    // Pick the highest-priority overlapping hitbox this tick (hit priority).
    let best: (typeof located.window.hitboxes)[number] | null = null;
    for (const hb of located.window.hitboxes) {
      const mirroredOffsetX = attackerFacing < 0 ? fx.neg(hb.offsetX) : hb.offsetX;
      const worldX = fx.add(attackerX, mirroredOffsetX);
      const worldY = fx.add(attackerY, hb.offsetY);
      const box = makeBoxCentered(worldX, worldY, hb.width, hb.height);
      if (aabbOverlap(box, defenderBox)) {
        if (!best || hb.priority > best.priority) best = hb;
      }
    }
    if (!best) return;

    d[dBase + lastHitField] = moveInstance;

    const defenderState = d[dBase + FighterField.STATE] as FighterStateValue;

    if (defenderState === FighterStateId.SHIELD) {
      const shieldLoss = fx.mul(best.damage, SHIELD_DAMAGE_MULTIPLIER);
      const healthBefore = d[dBase + FighterField.SHIELD_HEALTH] as number;
      const healthAfter = fx.sub(healthBefore, shieldLoss);
      d[dBase + FighterField.SHIELD_HEALTH] = healthAfter > 0 ? healthAfter : 0;
      if (healthAfter <= 0) {
        d[dBase + FighterField.SHIELD_HEALTH] = SHIELD_MAX_HEALTH;
        d[dBase + FighterField.SHIELD_STUN] = SHIELD_BREAK_HITSTUN_TICKS;
      } else {
        const stunTicks = fx.toInt(fx.mul(best.damage, SHIELD_STUN_PER_DAMAGE));
        d[dBase + FighterField.SHIELD_STUN] = stunTicks < 1 ? 1 : stunTicks;
      }
      d[dBase + FighterField.VEL_X] = 0;
      d[dBase + FighterField.VEL_Y] = 0;
      return;
    }

    const percentBefore = d[dBase + FighterField.PERCENT] as number;
    const percentAfter = fx.add(percentBefore, best.damage);
    d[dBase + FighterField.PERCENT] = percentAfter;

    const magnitude = computeKnockbackMagnitude(
      best.damage,
      percentAfter,
      best.baseKnockback,
      best.knockbackGrowth,
      defenderChar.weight,
    );
    const angleIdx = attackerFacing < 0 ? mirrorAngleIdx(best.angleIdx) : best.angleIdx;

    const velX = fx.mul(cosLUT(angleIdx), magnitude);
    const velY = fx.mul(sinLUT(angleIdx), magnitude);
    d[dBase + FighterField.VEL_X] = velX;
    d[dBase + FighterField.VEL_Y] = velY;
    d[dBase + FighterField.HITSTUN] = computeHitstunTicks(magnitude);
    d[dBase + FighterField.GROUNDED] = 0;
    d[dBase + FighterField.MOVE_ID] = -1;
    d[dBase + FighterField.MOVE_FRAME] = 0;
    this.setState(dBase, FighterStateId.HITSTUN);
  }

  /** A fighter whose position leaves the blast-zone rectangle loses a
   * stock and respawns (or enters DEAD if that was their last stock). */
  private checkBlastZone(index: number): void {
    const base = index * FighterField.FIELD_COUNT;
    const d = this.data;
    if ((d[base + FighterField.STATE] as number) === FighterStateId.DEAD) return;
    const posX = d[base + FighterField.POS_X] as number;
    const posY = d[base + FighterField.POS_Y] as number;
    const outOfBounds =
      posX < BLAST_MIN_X || posX > BLAST_MAX_X || posY < BLAST_MIN_Y || posY > BLAST_MAX_Y;
    if (!outOfBounds) return;

    const stocksBefore = d[base + FighterField.STOCKS] as number;
    const stocksAfter = (stocksBefore - 1) | 0;
    d[base + FighterField.STOCKS] = stocksAfter < 0 ? 0 : stocksAfter;

    if (stocksAfter <= 0) {
      d[base + FighterField.VEL_X] = 0;
      d[base + FighterField.VEL_Y] = 0;
      d[base + FighterField.HITSTUN] = 0;
      d[base + FighterField.SHIELD_STUN] = 0;
      this.setState(base, FighterStateId.DEAD);
      return;
    }
    this.resetFighterForNewStock(index, false);
  }
}

