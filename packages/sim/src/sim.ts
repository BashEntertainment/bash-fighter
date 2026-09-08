// Deterministic simulation core: N fighters (2..32), gravity, ground
// collision against data-driven platform geometry, jump/movement, a
// declarative state machine, frame-data-driven attacks with a deterministic
// spatial-grid broad phase for hitbox/hurtbox resolution, percent +
// knockback + hitstun, shielding, and FFA scoring (battle-royale single
// elimination with a shrinking arena by default; timed-KO with respawns and
// classic multi-stock elimination as selectable match settings).
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
import type { CharacterData, MoveDef, MoveIdValue } from './moves/types.ts';
import { MoveId, findMove, moveTotalDuration, windowAtFrame } from './moves/types.ts';
import { makeBoxCentered, aabbOverlap, type Box } from './hitbox.ts';
import {
  computeKnockbackMagnitude,
  computeHitstunTicks,
  mirrorAngleIdx,
} from './knockback.ts';
import { sinLUT, cosLUT } from './math/fixed.ts';
import type { ArenaData, Platform } from './arena/types.ts';
import { DEFAULT_ARENA } from './arena/default-arena.ts';
import {
  type MatchSettings,
  resolveMatchSettings,
  respawnsEnabled,
} from './match-settings.ts';
import { computeCurrentBlastRect } from './arena-shrink.ts';
import { SpatialGrid } from './broadphase.ts';

export const MIN_FIGHTERS = 2;
export const MAX_FIGHTERS = 32;

// --- Tunables (Q16.16), later replaced by real tuning constants ----------
export const GRAVITY: Fixed = fx.fromFloat(-0.85);
export const GROUND_Y: Fixed = fx.fromInt(0);
export const JUMP_VELOCITY: Fixed = fx.fromFloat(14.0);
export const MOVE_SPEED: Fixed = fx.fromFloat(4.5);
export const TERMINAL_VELOCITY: Fixed = fx.fromFloat(-20.0);
// Retained for backward compatibility with anything referencing the old
// flat-stage constants directly; real geometry now comes from ArenaData.
export const STAGE_MIN_X: Fixed = fx.fromInt(-200);
export const STAGE_MAX_X: Fixed = fx.fromInt(200);
export const BLAST_MIN_X: Fixed = fx.fromInt(-260);
export const BLAST_MAX_X: Fixed = fx.fromInt(260);
export const BLAST_MIN_Y: Fixed = fx.fromInt(-120);
export const BLAST_MAX_Y: Fixed = fx.fromInt(220);

export const HITSTUN_DI_ACCEL_PER_TICK: Fixed = fx.fromFloat(0.06);
export const GROUND_FRICTION: Fixed = fx.fromFloat(0.9);

export const STARTING_STOCKS = 3;
export const SHIELD_MAX_HEALTH: Fixed = fx.fromInt(100);
export const SHIELD_DAMAGE_MULTIPLIER: Fixed = fx.fromFloat(1.2);
export const SHIELD_STUN_PER_DAMAGE: Fixed = fx.fromFloat(1.0);
export const SHIELD_BREAK_HITSTUN_TICKS = 120;

/** Layout of one fighter's slice inside the flat Int32Array state buffer.
 * Per-fighter hit-dedup fields (LAST_HIT_FROM_0/1 in the 2-fighter version)
 * were pulled out into a separate N*N dedup table sized from the actual
 * fighter count (see Sim.dedupIndex) so this stride does not grow with N. */
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
  KO_COUNT: 15, // FFA scoring: KOs this fighter has landed on others
  DEATH_COUNT: 16, // times this fighter has been KO'd
  RESPAWN_TIMER: 17, // ticks remaining until respawn (RESPAWN state only)
  INVULN_TIMER: 18, // ticks remaining of post-respawn invulnerability
  LAST_ATTACKER: 19, // index of last fighter who damaged us, -1 if none
  ELIMINATED: 20, // 0/1: out of the match for good (DEAD, no more lives)
  ELIMINATED_TICK: 21, // tick this fighter was eliminated, -1 if not
  PLACEMENT: 22, // 1 = winner, N = first eliminated; 0 = not yet decided
  FIELD_COUNT: 23,
} as const;

const RNG_FIELD_WORDS = 4; // s0 lo/hi, s1 lo/hi
const TICK_WORDS = 1;
const ELIMINATED_COUNT_WORDS = 1;
const BLAST_RECT_WORDS = 4; // current (possibly shrunk) minX/maxX/minY/maxY

/** Opaque, preallocated snapshot of full sim state. Plain Int32Array so it
 * is cheap to copy (TypedArray.set) and trivial to hash for the determinism
 * test. Never resized after creation. Size depends on fighter count N. */
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
  koCount: number;
  deathCount: number;
  invulnTicks: number;
  eliminated: boolean;
  eliminatedTick: number; // -1 if not eliminated
  placement: number; // 0 until decided; 1 = winner
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

const STICK_MOVE_THRESHOLD: Fixed = fx.fromFloat(0.5);
// Fighters mid-RESPAWN/DEAD are parked far below the arena so they can
// never be a candidate in the broad-phase grid or blast-zone check while
// inactive; this is simpler than adding an "active" bit to every hot-path
// read and is itself a deterministic constant, not wall-clock/random.
const LIMBO_Y: Fixed = fx.fromInt(-100000);

export class Sim {
  // Preallocated hot-path state. Never reassigned after construction.
  private readonly data: Int32Array;
  private readonly dedup: Int32Array; // N*N: last MOVE_INSTANCE of attacker i that hit defender j
  private rng: RngState;
  private tick = 0;
  private eliminatedCount = 0;
  private blastMinX: Fixed;
  private blastMaxX: Fixed;
  private blastMinY: Fixed;
  private blastMaxY: Fixed;
  private readonly characters: readonly CharacterData[];
  private readonly arena: ArenaData;
  private readonly settings: MatchSettings;
  private readonly grid: SpatialGrid;
  // Scratch arrays reused every tick inside resolveHits, preallocated once
  // so the hot path never allocates.
  private readonly activeFlag: Uint8Array;

  readonly numFighters: number;

  constructor(
    seed: number | bigint,
    numFighters: number,
    characters?: readonly CharacterData[],
    arena: ArenaData = DEFAULT_ARENA,
    matchSettings: Partial<MatchSettings> = {},
  ) {
    if (numFighters < MIN_FIGHTERS || numFighters > MAX_FIGHTERS) {
      throw new RangeError(
        `Sim: numFighters must be between ${MIN_FIGHTERS} and ${MAX_FIGHTERS}, got ${numFighters}`,
      );
    }
    this.numFighters = numFighters;
    this.data = new Int32Array(numFighters * FighterField.FIELD_COUNT);
    this.dedup = new Int32Array(numFighters * numFighters);
    this.activeFlag = new Uint8Array(numFighters);
    this.grid = new SpatialGrid(numFighters);
    this.rng = seedRng(seed);
    this.characters =
      characters ?? Array.from({ length: numFighters }, () => DEFAULT_CHARACTER);
    if (this.characters.length !== numFighters) {
      throw new RangeError(
        `Sim: expected ${numFighters} character entries, got ${this.characters.length}`,
      );
    }
    this.arena = arena;
    this.settings = resolveMatchSettings(matchSettings);
    this.blastMinX = arena.blastMinX;
    this.blastMaxX = arena.blastMaxX;
    this.blastMinY = arena.blastMinY;
    this.blastMaxY = arena.blastMaxY;
    this.dedup.fill(-1);
    for (let i = 0; i < numFighters; i++) {
      this.fullResetFighter(i);
    }
  }

  private spawnPoint(index: number): { x: Fixed; y: Fixed } {
    const points = this.arena.spawnPoints;
    const p = points[index % points.length] ?? { x: 0, y: GROUND_Y };
    return p;
  }

  /** Full reset for match start: stocks, KO/death counts, placement, and
   * elimination state all cleared. Distinct from `respawnFighter`, which
   * is a mid-match life reset that preserves match-level stats. */
  private fullResetFighter(index: number): void {
    const base = index * FighterField.FIELD_COUNT;
    const d = this.data;
    const sp = this.spawnPoint(index);
    d[base + FighterField.POS_X] = sp.x as number;
    d[base + FighterField.POS_Y] = sp.y as number;
    d[base + FighterField.VEL_X] = 0;
    d[base + FighterField.VEL_Y] = 0;
    d[base + FighterField.STATE] = FighterStateId.IDLE;
    d[base + FighterField.FACING] = index % 2 === 0 ? 1 : -1;
    d[base + FighterField.GROUNDED] = 1;
    d[base + FighterField.MOVE_ID] = -1;
    d[base + FighterField.MOVE_FRAME] = 0;
    d[base + FighterField.MOVE_INSTANCE] = 0;
    d[base + FighterField.PERCENT] = 0;
    d[base + FighterField.STOCKS] = this.settings.startingStocks;
    d[base + FighterField.SHIELD_HEALTH] = SHIELD_MAX_HEALTH;
    d[base + FighterField.SHIELD_STUN] = 0;
    d[base + FighterField.HITSTUN] = 0;
    d[base + FighterField.KO_COUNT] = 0;
    d[base + FighterField.DEATH_COUNT] = 0;
    d[base + FighterField.RESPAWN_TIMER] = 0;
    d[base + FighterField.INVULN_TIMER] = 0;
    d[base + FighterField.LAST_ATTACKER] = -1;
    d[base + FighterField.ELIMINATED] = 0;
    d[base + FighterField.ELIMINATED_TICK] = -1;
    d[base + FighterField.PLACEMENT] = 0;
  }

  /** Mid-match life reset after a non-final KO: position/percent/shield
   * reset, brief invulnerability granted, but KO/death counts, stocks (the
   * caller already decremented) and elimination state are untouched. */
  private respawnFighter(index: number): void {
    const base = index * FighterField.FIELD_COUNT;
    const d = this.data;
    const sp = this.spawnPoint(index);
    d[base + FighterField.POS_X] = sp.x as number;
    d[base + FighterField.POS_Y] = sp.y as number;
    d[base + FighterField.VEL_X] = 0;
    d[base + FighterField.VEL_Y] = 0;
    d[base + FighterField.PERCENT] = 0;
    d[base + FighterField.SHIELD_HEALTH] = SHIELD_MAX_HEALTH;
    d[base + FighterField.SHIELD_STUN] = 0;
    d[base + FighterField.HITSTUN] = 0;
    d[base + FighterField.MOVE_ID] = -1;
    d[base + FighterField.MOVE_FRAME] = 0;
    d[base + FighterField.GROUNDED] = 1;
    d[base + FighterField.RESPAWN_TIMER] = 0;
    d[base + FighterField.INVULN_TIMER] = this.settings.respawnInvulnTicks;
    this.setState(base, FighterStateId.IDLE);
  }

  getTick(): number {
    return this.tick;
  }

  getMatchSettings(): MatchSettings {
    return this.settings;
  }

  /** Current (possibly shrunk) blast-zone rectangle, exposed for renderers
   * and spectator cameras — see arena-shrink.ts. */
  getCurrentBlastRect(): { minX: Fixed; maxX: Fixed; minY: Fixed; maxY: Fixed } {
    return { minX: this.blastMinX, maxX: this.blastMaxX, minY: this.blastMinY, maxY: this.blastMaxY };
  }

  private aliveCount(): number {
    let count = 0;
    for (let i = 0; i < this.numFighters; i++) {
      const base = i * FighterField.FIELD_COUNT;
      if ((this.data[base + FighterField.ELIMINATED] as number) === 0) count++;
    }
    return count;
  }

  /** Index of the sole remaining fighter, or null if the match is still
   * ongoing or ended in a simultaneous multi-KO with no survivor. Only
   * meaningful for elimination-style modes ('battleRoyale'/'stocks'); for
   * 'timedKO' use `getLeaderboard()` once the time limit is reached. */
  getWinner(): number | null {
    const alive: number[] = [];
    for (let i = 0; i < this.numFighters; i++) {
      const base = i * FighterField.FIELD_COUNT;
      if ((this.data[base + FighterField.ELIMINATED] as number) === 0) alive.push(i);
    }
    if (alive.length === 1) return alive[0] as number;
    return null;
  }

  isMatchOver(): boolean {
    if (this.settings.winCondition === 'timedKO') {
      return this.tick >= this.settings.timeLimitTicks;
    }
    return this.aliveCount() <= 1;
  }

  /** Fighter indices ordered by result: for elimination modes this is
   * placement order (1st..last); for 'timedKO' it is KO count descending,
   * ties broken by fewer deaths then lower fighter index, both fixed,
   * deterministic tie-breaks (never insertion/hash order). */
  getLeaderboard(): number[] {
    const indices = Array.from({ length: this.numFighters }, (_, i) => i);
    if (this.settings.winCondition === 'timedKO') {
      indices.sort((a, b) => {
        const ka = this.getFighter(a);
        const kb = this.getFighter(b);
        if (kb.koCount !== ka.koCount) return kb.koCount - ka.koCount;
        if (ka.deathCount !== kb.deathCount) return ka.deathCount - kb.deathCount;
        return a - b;
      });
      return indices;
    }
    indices.sort((a, b) => {
      const pa = this.data[a * FighterField.FIELD_COUNT + FighterField.PLACEMENT] as number;
      const pb = this.data[b * FighterField.FIELD_COUNT + FighterField.PLACEMENT] as number;
      const ra = pa === 0 ? Number.MAX_SAFE_INTEGER : pa;
      const rb = pb === 0 ? Number.MAX_SAFE_INTEGER : pb;
      if (ra !== rb) return ra - rb;
      return a - b;
    });
    return indices;
  }

  getFighter(index: number): FighterSnapshot {
    if (index < 0 || index >= this.numFighters) {
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
      koCount: d[base + FighterField.KO_COUNT] as number,
      deathCount: d[base + FighterField.DEATH_COUNT] as number,
      invulnTicks: d[base + FighterField.INVULN_TIMER] as number,
      eliminated: (d[base + FighterField.ELIMINATED] as number) !== 0,
      eliminatedTick: d[base + FighterField.ELIMINATED_TICK] as number,
      placement: d[base + FighterField.PLACEMENT] as number,
    };
  }

  private stateWords(): number {
    return (
      this.numFighters * FighterField.FIELD_COUNT +
      this.numFighters * this.numFighters +
      RNG_FIELD_WORDS +
      TICK_WORDS +
      ELIMINATED_COUNT_WORDS +
      BLAST_RECT_WORDS
    );
  }

  /** Allocate a StateBuffer sized for this sim. Call once at match setup /
   * whenever a rollback buffer pool is being built — never inside the hot
   * per-tick loop. */
  createStateBuffer(): StateBuffer {
    return new Int32Array(this.stateWords());
  }

  /** Copy current sim state into `buf` (no allocation). */
  saveState(buf: StateBuffer): void {
    if (buf.length !== this.stateWords()) {
      throw new RangeError('saveState: buffer size mismatch');
    }
    const fighterWords = this.numFighters * FighterField.FIELD_COUNT;
    const dedupWords = this.numFighters * this.numFighters;
    buf.set(this.data, 0);
    buf.set(this.dedup, fighterWords);
    let off = fighterWords + dedupWords;
    const [s0lo, s0hi] = bigintToWords(this.rng.s0);
    const [s1lo, s1hi] = bigintToWords(this.rng.s1);
    buf[off++] = s0lo;
    buf[off++] = s0hi;
    buf[off++] = s1lo;
    buf[off++] = s1hi;
    buf[off++] = this.tick;
    buf[off++] = this.eliminatedCount;
    buf[off++] = this.blastMinX as number;
    buf[off++] = this.blastMaxX as number;
    buf[off++] = this.blastMinY as number;
    buf[off++] = this.blastMaxY as number;
  }

  /** Restore sim state from a previously saved buffer (no allocation). */
  loadState(buf: StateBuffer): void {
    if (buf.length !== this.stateWords()) {
      throw new RangeError('loadState: buffer size mismatch');
    }
    const fighterWords = this.numFighters * FighterField.FIELD_COUNT;
    const dedupWords = this.numFighters * this.numFighters;
    this.data.set(buf.subarray(0, fighterWords));
    this.dedup.set(buf.subarray(fighterWords, fighterWords + dedupWords));
    let off = fighterWords + dedupWords;
    const s0 = wordsToBigint(buf[off] as number, buf[off + 1] as number);
    const s1 = wordsToBigint(buf[off + 2] as number, buf[off + 3] as number);
    off += 4;
    this.rng = { s0, s1 };
    this.tick = buf[off++] as number;
    this.eliminatedCount = buf[off++] as number;
    this.blastMinX = buf[off++] as number;
    this.blastMaxX = buf[off++] as number;
    this.blastMinY = buf[off++] as number;
    this.blastMaxY = buf[off++] as number;
  }

  private dedupIndex(attacker: number, defender: number): number {
    return attacker * this.numFighters + defender;
  }

  /** True while `posX`/`posY` are over some platform's solid surface,
   * i.e. there is ground to catch a fall here at all. Used only to decide
   * whether normal (non-hitstun) movement clamps to a platform; the actual
   * landing test in stepFighter also needs the specific platform's y. */
  private findLandingPlatform(posX: Fixed, prevY: Fixed, nextY: Fixed): Platform | null {
    let best: Platform | null = null;
    for (const p of this.arena.platforms) {
      if (posX < p.minX || posX > p.maxX) continue;
      if (prevY >= p.y && nextY <= p.y) {
        if (best === null || p.y > best.y) best = p;
      }
    }
    return best;
  }

  private onAnyPlatform(posX: Fixed): boolean {
    for (const p of this.arena.platforms) {
      if (posX >= p.minX && posX <= p.maxX) return true;
    }
    return false;
  }

  /** Advance the sim by exactly one fixed 60Hz tick. Must not allocate. */
  advance(inputs: readonly InputFrame[]): void {
    if (inputs.length !== this.numFighters) {
      throw new RangeError(`advance: expected ${this.numFighters} inputs, got ${inputs.length}`);
    }
    for (let i = 0; i < this.numFighters; i++) {
      this.stepFighter(i, inputs[i] as InputFrame);
    }
    // Hit resolution runs after movement, in fixed ascending fighter-index
    // order for attackers, and the broad-phase grid's candidate order is
    // itself index-ordered (see broadphase.ts) — never Map/Set iteration,
    // hash ordering, or anything tied to object identity. So the outcome
    // is deterministic regardless of "who acted first" in wall-clock terms
    // and regardless of the order fighters were constructed/added in.
    this.grid.build(
      this.numFighters,
      (i) => this.data[i * FighterField.FIELD_COUNT + FighterField.POS_X] as number,
      (i) => this.data[i * FighterField.FIELD_COUNT + FighterField.POS_Y] as number,
      (i) => {
        const s = this.data[i * FighterField.FIELD_COUNT + FighterField.STATE] as number;
        return s !== FighterStateId.DEAD && s !== FighterStateId.RESPAWN;
      },
    );
    for (let attacker = 0; attacker < this.numFighters; attacker++) {
      this.resolveHitsFor(attacker);
    }
    // Recompute the arena-shrink blast rectangle from *this* tick's alive
    // count before checking anyone against it, so a KO that just reduced
    // the alive count tightens the ring the same tick for everyone still
    // in play (deterministic function of tick + alive count, see
    // arena-shrink.ts; stored back into state so save/load carries it).
    const rect = computeCurrentBlastRect(this.arena, this.tick, this.aliveCount(), this.numFighters, this.settings);
    this.blastMinX = rect.minX;
    this.blastMaxX = rect.maxX;
    this.blastMinY = rect.minY;
    this.blastMaxY = rect.maxY;
    for (let i = 0; i < this.numFighters; i++) {
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

    if ((d[base + FighterField.INVULN_TIMER] as number) > 0) {
      d[base + FighterField.INVULN_TIMER] = (d[base + FighterField.INVULN_TIMER] as number) - 1;
    }

    if (state === FighterStateId.DEAD) {
      // Eliminated for good: no physics, no input, no timers.
      return;
    }

    if (state === FighterStateId.RESPAWN) {
      let timer = (d[base + FighterField.RESPAWN_TIMER] as number) - 1;
      if (timer <= 0) {
        this.respawnFighter(index);
      } else {
        d[base + FighterField.RESPAWN_TIMER] = timer;
      }
      void timer;
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
      velX = fx.add(velX, fx.mul(input.stickX, HITSTUN_DI_ACCEL_PER_TICK));
      velY = fx.add(velY, fx.mul(input.stickY, HITSTUN_DI_ACCEL_PER_TICK));
      if (grounded) {
        velX = fx.mul(velX, GROUND_FRICTION);
      } else {
        velY = fx.add(velY, GRAVITY);
        velY = fx.max(velY, TERMINAL_VELOCITY);
      }
      const prevY = posY;
      posX = fx.add(posX, velX);
      posY = fx.add(posY, velY);
      const landing = this.findLandingPlatform(posX, prevY, posY);
      if (landing) {
        posY = landing.y;
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
      if (!grounded) {
        velY = fx.add(velY, GRAVITY);
        velY = fx.max(velY, TERMINAL_VELOCITY);
      } else {
        velX = 0;
      }
      const prevY = posY;
      posX = fx.add(posX, velX);
      posX = this.clampToPlatform(posX);
      posY = fx.add(posY, velY);
      const landing = this.findLandingPlatform(posX, prevY, posY);
      if (landing) {
        posY = landing.y;
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
      let chosen: MoveIdValue;
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

    const prevY = posY;
    posX = fx.add(posX, velX);
    posX = this.clampToPlatform(posX);
    posY = fx.add(posY, velY);

    const landing = this.findLandingPlatform(posX, prevY, posY);
    if (landing) {
      posY = landing.y;
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

  /** Clamp posX to whichever platform's x-range currently contains it, so
   * voluntary movement cannot walk off a platform edge under normal
   * control (only knockback can leave one, matching the original 2-fighter
   * behavior, generalized to "some platform" rather than "the platform"). */
  private clampToPlatform(posX: Fixed): Fixed {
    let best = posX;
    let bestDist = Number.POSITIVE_INFINITY;
    for (const p of this.arena.platforms) {
      const clamped = fx.clamp(posX, p.minX, p.maxX);
      const dist = Math.abs(fx.toFloat(fx.sub(clamped, posX)));
      if (dist < bestDist) {
        bestDist = dist;
        best = clamped;
      }
    }
    return best;
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
   * window's hitboxes (if any) and resolve overlap against nearby
   * defenders via the broad-phase grid. One hit per target per move
   * activation, enforced via the MOVE_INSTANCE / dedup table. */
  private resolveHitsFor(attacker: number): void {
    const d = this.data;
    const aBase = attacker * FighterField.FIELD_COUNT;
    if ((d[aBase + FighterField.STATE] as number) !== FighterStateId.ATTACK) return;

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
    const moveInstance = d[aBase + FighterField.MOVE_INSTANCE] as number;

    for (const hb of located.window.hitboxes) {
      const mirroredOffsetX = attackerFacing < 0 ? fx.neg(hb.offsetX) : hb.offsetX;
      const worldX = fx.add(attackerX, mirroredOffsetX);
      const worldY = fx.add(attackerY, hb.offsetY);
      const box: Box = makeBoxCentered(worldX, worldY, hb.width, hb.height);
      this.grid.queryBox(box.minX, box.minY, box.maxX, box.maxY, (defender) => {
        if (defender === attacker) return;
        this.tryApplyHit(attacker, defender, box, hb, moveInstance);
      });
    }
  }

  private tryApplyHit(
    attacker: number,
    defender: number,
    hitboxBox: Box,
    hb: MoveDef['windows'][number]['hitboxes'][number],
    moveInstance: number,
  ): void {
    const d = this.data;
    const dBase = defender * FighterField.FIELD_COUNT;
    const defenderState = d[dBase + FighterField.STATE] as number;
    if (defenderState === FighterStateId.DEAD || defenderState === FighterStateId.RESPAWN) return;
    if ((d[dBase + FighterField.INVULN_TIMER] as number) > 0) return;

    const dedupIdx = this.dedupIndex(attacker, defender);
    if ((this.dedup[dedupIdx] as number) === moveInstance) return; // already hit this activation

    const defenderChar = this.characters[defender] as CharacterData;
    const defenderX = d[dBase + FighterField.POS_X] as number;
    const defenderY = d[dBase + FighterField.POS_Y] as number;
    const defenderBox = makeBoxCentered(defenderX, defenderY, defenderChar.hurtboxWidth, defenderChar.hurtboxHeight);
    if (!aabbOverlap(hitboxBox, defenderBox)) return;

    this.dedup[dedupIdx] = moveInstance;
    d[dBase + FighterField.LAST_ATTACKER] = attacker;

    if (defenderState === FighterStateId.SHIELD) {
      const shieldLoss = fx.mul(hb.damage, SHIELD_DAMAGE_MULTIPLIER);
      const healthBefore = d[dBase + FighterField.SHIELD_HEALTH] as number;
      const healthAfter = fx.sub(healthBefore, shieldLoss);
      d[dBase + FighterField.SHIELD_HEALTH] = healthAfter > 0 ? healthAfter : 0;
      if (healthAfter <= 0) {
        d[dBase + FighterField.SHIELD_HEALTH] = SHIELD_MAX_HEALTH;
        d[dBase + FighterField.SHIELD_STUN] = SHIELD_BREAK_HITSTUN_TICKS;
      } else {
        const stunTicks = fx.toInt(fx.mul(hb.damage, SHIELD_STUN_PER_DAMAGE));
        d[dBase + FighterField.SHIELD_STUN] = stunTicks < 1 ? 1 : stunTicks;
      }
      d[dBase + FighterField.VEL_X] = 0;
      d[dBase + FighterField.VEL_Y] = 0;
      return;
    }

    const percentBefore = d[dBase + FighterField.PERCENT] as number;
    const percentAfter = fx.add(percentBefore, hb.damage);
    d[dBase + FighterField.PERCENT] = percentAfter;

    const magnitude = computeKnockbackMagnitude(
      hb.damage,
      percentAfter,
      hb.baseKnockback,
      hb.knockbackGrowth,
      defenderChar.weight,
    );
    const attackerBase = attacker * FighterField.FIELD_COUNT;
    const attackerFacing = d[attackerBase + FighterField.FACING] as number;
    const angleIdx = attackerFacing < 0 ? mirrorAngleIdx(hb.angleIdx) : hb.angleIdx;

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

  /** A fighter whose position leaves the current (possibly shrunk)
   * blast-zone rectangle loses a life. Elimination-mode fighters
   * (battleRoyale/stocks) that are out of stocks go to DEAD permanently and
   * get their placement recorded; everyone else (timedKO, or a
   * stocks-mode fighter with lives left) goes to RESPAWN for a brief
   * invulnerable window instead. */
  private checkBlastZone(index: number): void {
    const base = index * FighterField.FIELD_COUNT;
    const d = this.data;
    const state = d[base + FighterField.STATE] as number;
    if (state === FighterStateId.DEAD || state === FighterStateId.RESPAWN) return;
    const posX = d[base + FighterField.POS_X] as number;
    const posY = d[base + FighterField.POS_Y] as number;
    const outOfBounds =
      posX < this.blastMinX || posX > this.blastMaxX || posY < this.blastMinY || posY > this.blastMaxY;
    if (!outOfBounds) return;

    d[base + FighterField.DEATH_COUNT] = (d[base + FighterField.DEATH_COUNT] as number) + 1;
    const attacker = d[base + FighterField.LAST_ATTACKER] as number;
    if (attacker >= 0 && attacker !== index) {
      const attackerBase = attacker * FighterField.FIELD_COUNT;
      d[attackerBase + FighterField.KO_COUNT] = (d[attackerBase + FighterField.KO_COUNT] as number) + 1;
    }
    d[base + FighterField.LAST_ATTACKER] = -1;

    const respawns = respawnsEnabled(this.settings);
    let stocksAfter = d[base + FighterField.STOCKS] as number;
    if (!respawns) {
      stocksAfter = ((d[base + FighterField.STOCKS] as number) - 1) | 0;
      d[base + FighterField.STOCKS] = stocksAfter < 0 ? 0 : stocksAfter;
    }

    d[base + FighterField.VEL_X] = 0;
    d[base + FighterField.VEL_Y] = 0;
    d[base + FighterField.HITSTUN] = 0;
    d[base + FighterField.SHIELD_STUN] = 0;

    if (!respawns && stocksAfter <= 0) {
      d[base + FighterField.ELIMINATED] = 1;
      d[base + FighterField.ELIMINATED_TICK] = this.tick;
      this.eliminatedCount = (this.eliminatedCount + 1) | 0;
      d[base + FighterField.PLACEMENT] = this.numFighters - this.eliminatedCount + 1;
      d[base + FighterField.POS_X] = 0;
      d[base + FighterField.POS_Y] = LIMBO_Y;
      this.setState(base, FighterStateId.DEAD);
      return;
    }

    d[base + FighterField.RESPAWN_TIMER] = this.settings.respawnDelayTicks;
    d[base + FighterField.POS_X] = 0;
    d[base + FighterField.POS_Y] = LIMBO_Y;
    // Percent/shield reset immediately on the KO rather than only when the
    // respawn timer elapses: match UI and tests observe the new life's 0%
    // the same tick stocks drop, not after a delay.
    d[base + FighterField.PERCENT] = 0;
    d[base + FighterField.SHIELD_HEALTH] = SHIELD_MAX_HEALTH;
    this.setState(base, FighterStateId.RESPAWN);
  }
}
