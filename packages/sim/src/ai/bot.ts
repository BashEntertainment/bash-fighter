// Bot input source (see Netcode Design Part 1/4 and this task's brief): a
// bot is NOT a special kind of fighter inside Sim. It is an input source
// that produces the exact same InputFrame a human's keyboard produces, fed
// into Sim.advance() by the server (architecture option (a) — the server
// computes bot inputs every tick from read-only sim state, same as it
// relays a human's inputs; nothing in packages/sim needs a concept of
// "bot" and clients predict bot-controlled slots exactly as they predict
// remote humans). This keeps determinism trivially intact: two Sims fed
// the same seed and the same recorded InputFrame[] — bot-authored or not —
// produce identical hash sequences, because a BotController only reads
// through the same public snapshot accessors any test or renderer uses
// (getFighter/getItem/getHazard/getCurrentBlastRect/getLeaderboard) and
// only ever draws randomness from its own seeded PRNG stream, never
// Math.random/Date.now.
import * as fx from '../math/fixed.ts';
import type { Fixed } from '../math/fixed.ts';
import { seedRng, nextBounded, type RngState } from '../math/prng.ts';
import { BUTTON_JUMP, BUTTON_ATTACK, BUTTON_SHIELD, makeInputFrame, type InputFrame } from '../types.ts';
import type { Sim, FighterSnapshot } from '../sim.ts';
import { MAX_JUMPS } from '../sim.ts';

export const BotDifficulty = {
  EASY: 0,
  MEDIUM: 1,
  HARD: 2,
} as const;
export type BotDifficultyValue = (typeof BotDifficulty)[keyof typeof BotDifficulty];

interface DifficultyTuning {
  /** Ticks between decisions; the bot only re-reads sim state and picks a
   * new intent this often — the "reaction time" a human would need. The
   * same cached input keeps being replayed in between, so a slow bot is
   * slow to *notice* things, never physically weaker. */
  reactionTicks: number;
  /** +/- jitter added to reactionTicks (deterministic, drawn from the
   * bot's own PRNG) so many bots on the same difficulty don't all decide
   * on the exact same tick. */
  reactionJitterTicks: number;
  /** Probability in [0,1000) (compared against nextBounded(1000)) that a
   * decision tick's stick input gets a random wobble instead of the
   * precise aim, modelling imprecise execution rather than a weaker hit. */
  wobbleChancePerMille: number;
  /** Fixed-point magnitude of that wobble, added to stickX/stickY before
   * clamping to [-ONE, ONE]. */
  wobbleMagnitude: Fixed;
  /** Probability in [0,1000) that an in-range attack decision is skipped
   * this decision tick (a missed opening a human would sometimes miss). */
  hesitationPerMille: number;
  /** Probability in [0,1000) that this decision the bot ignores whatever
   * target it would otherwise chase and just idles/wanders instead --
   * models a genuinely passive bot rather than a merely slow-and-sloppy
   * one. 0 at MEDIUM/HARD (unchanged prior behaviour). */
  passiveChancePerMille: number;
  /** Flat score penalty added when scoring a candidate target that is in
   * this bot's `protectedIndices` set (see BotController constructor).
   * Large at EASY so a passive bot goes out of its way to avoid piling
   * onto a human player when any other opponent is remotely competitive
   * as a target; 0 at MEDIUM/HARD, where a human is just another fighter. */
  protectedTargetPenalty: number;
  /** Multiplier applied to the existing anti-clump density penalty
   * (CLUSTER_PENALTY) specifically when the candidate being scored is a
   * protected index -- makes an already-crowded human even less
   * appealing to a fresh EASY bot than the generic anti-clump term alone
   * would, without touching how bots treat each other. 1 (no change) at
   * MEDIUM/HARD. */
  protectedClusterMultiplier: number;
}

const TUNING: Record<BotDifficultyValue, DifficultyTuning> = {
  // EASY was tuned in the past to still be a reasonably active fighter --
  // slow and sloppy, but chasing and swinging just as readily as MEDIUM.
  // That is not what "easy" means to a first-time player dropped into a
  // 20-fighter FFA: reaction delay and imprecision alone cannot save you
  // from being the nearest target to several bots at once. EASY now adds
  // genuine passivity (often doesn't chase at all) and a strong aversion
  // to piling onto a protected (human) target on top of the existing
  // reaction/wobble/hesitation slowdowns.
  [BotDifficulty.EASY]: {
    reactionTicks: 40, // ~667ms
    reactionJitterTicks: 16,
    wobbleChancePerMille: 500,
    wobbleMagnitude: fx.fromFloat(0.8),
    hesitationPerMille: 550,
    passiveChancePerMille: 400,
    protectedTargetPenalty: 900.0,
    protectedClusterMultiplier: 3.0,
  },
  [BotDifficulty.MEDIUM]: {
    reactionTicks: 14, // ~230ms
    reactionJitterTicks: 6,
    wobbleChancePerMille: 180,
    wobbleMagnitude: fx.fromFloat(0.35),
    hesitationPerMille: 120,
    passiveChancePerMille: 0,
    protectedTargetPenalty: 0,
    protectedClusterMultiplier: 1.0,
  },
  [BotDifficulty.HARD]: {
    reactionTicks: 6, // 100ms
    reactionJitterTicks: 3,
    wobbleChancePerMille: 60,
    wobbleMagnitude: fx.fromFloat(0.15),
    hesitationPerMille: 30,
    passiveChancePerMille: 0,
    protectedTargetPenalty: 0,
    protectedClusterMultiplier: 1.0,
  },
};

const ATTACK_RANGE_X: Fixed = fx.fromFloat(3.0);
const ATTACK_RANGE_Y: Fixed = fx.fromFloat(3.0);
const ITEM_SEEK_RANGE_X: Fixed = fx.fromFloat(60.0);
/** How close (fixed units) to the current, possibly-shrunk blast rect edge
 * before the bot treats "stand your ground" as unsafe and prioritises
 * moving inward over anything else — chasing a target or an item. */
const EDGE_SAFETY_MARGIN: Fixed = fx.fromFloat(18.0);
/** Anti-clumping: fighters within this radius of a candidate target count
 * toward its "crowded" score (see BotController.pickTarget). Squared
 * float units to avoid a sqrt per candidate pair. */
const CLUSTER_RADIUS_SQ = 12.0 * 12.0;
/** Score penalty in squared-distance units (scoring uses squared
 * distance throughout to avoid a sqrt/transcendental call, which
 * packages/sim's lint rule forbids for determinism) added per other
 * fighter already near a candidate target. ~150 is equivalent to that
 * target being roughly 12 world units farther away per crowder, enough
 * that a target already flanked by 1-2 others loses out to a lone
 * opponent noticeably farther off. */
const CLUSTER_PENALTY = 150.0;
/** Score bonus (squared-distance units) for keeping the current target,
 * so equally-good candidates don't cause flicker between decisions. */
const STICKINESS_BONUS = 400.0;
/** Decisions a target lock lasts before pickTarget re-rolls, in addition
 * to the jittered extra below. At MEDIUM's ~230ms/decision this is
 * roughly 1.8-3.2s per lock — long enough to actually fight, short enough
 * that pairs don't orbit for a whole match. */
const TARGET_LOCK_DECISIONS = 8;
const ONE = fx.ONE;
const EMPTY_SET: ReadonlySet<number> = new Set();

function clampStick(v: Fixed): Fixed {
  return fx.clamp(v, fx.neg(ONE), ONE);
}

function signOf(v: Fixed): Fixed {
  if (v > 0) return ONE;
  if (v < 0) return fx.neg(ONE);
  return 0;
}

/**
 * One bot's input source. Holds only its own small piece of mutable state
 * (a private PRNG stream + the last decision) — never touches Sim's
 * internals, never allocates inside the hot path beyond the plain object
 * literal an InputFrame already is (matching how a human input adapter
 * would hand a fresh InputFrame to the server each tick).
 */
export class BotController {
  readonly fighterIndex: number;
  readonly difficulty: BotDifficultyValue;
  private rng: RngState;
  private decisionCooldown = 0;
  private cached: InputFrame = makeInputFrame();
  /** Sticky target index (-1 = none yet). Kept across decisions so bots
   * don't flicker between two equally-close opponents; only re-evaluated
   * on the normal decision cadence, plus forced re-rolls (see
   * targetLockTicks) so a mutual stare-down eventually breaks up. */
  private targetIndex = -1;
  /** Decisions remaining before this bot is willing to switch target even
   * if a clearly better one exists (prevents rapid flicker), decremented
   * once per decision. Forced to 0 periodically to break up orbiting
   * pairs/clumps and to keep targets changing over a match. */
  private targetLockDecisions = 0;
  private targetSwitchCount = 0;

  /**
   * @param seed Deterministic per-bot seed. Callers should derive this from
   *   the match seed and fighterIndex (e.g. `matchSeed ^ (fighterIndex * 0x9e3779b1)`)
   *   so a rerun of the same match seed reproduces the same bot decisions.
   */
  /** Fighter indices this bot should go out of its way to avoid piling
   * onto (in practice: human-controlled seats). Only has teeth at EASY,
   * where protectedTargetPenalty/protectedClusterMultiplier are non-zero.
   * Empty by default so existing callers (tests, bot-vs-bot metrics) are
   * unaffected. */
  private readonly protectedIndices: ReadonlySet<number>;

  constructor(fighterIndex: number, difficulty: BotDifficultyValue, seed: number, protectedIndices?: ReadonlySet<number>) {
    this.fighterIndex = fighterIndex;
    this.difficulty = difficulty;
    this.rng = seedRng(seed);
    this.protectedIndices = protectedIndices ?? EMPTY_SET;
  }

  private rollPerMille(): number {
    const { value, state } = nextBounded(this.rng, 1000);
    this.rng = state;
    return value;
  }

  private rollWobble(): Fixed {
    const { value, state } = nextBounded(this.rng, 2001); // [-1000, 1000]
    this.rng = state;
    return fx.mul(fx.fromInt(value - 1000), fx.fromFloat(0.001));
  }

  /** Computes (or replays, if still inside the reaction-delay window) this
   * tick's InputFrame. Called once per fighter per Sim.advance() call by
   * the server, same call site as reading a human seat's pending input. */
  nextInput(sim: Sim): InputFrame {
    const self = sim.getFighter(this.fighterIndex);
    if (self.eliminated) {
      return makeInputFrame();
    }
    if (this.decisionCooldown > 0) {
      this.decisionCooldown -= 1;
      return this.cached;
    }
    const tuning = TUNING[this.difficulty];
    const jitter =
      tuning.reactionJitterTicks > 0
        ? nextBounded(this.rng, tuning.reactionJitterTicks * 2 + 1).value - tuning.reactionJitterTicks
        : 0;
    this.decisionCooldown = Math.max(1, tuning.reactionTicks + jitter);
    this.cached = this.decide(sim, self, tuning);
    return this.cached;
  }

  private decide(sim: Sim, self: FighterSnapshot, tuning: DifficultyTuning): InputFrame {
    let stickX: Fixed = 0;
    let stickY: Fixed = 0;
    let buttons = 0;

    const blast = sim.getCurrentBlastRect();
    const unsafe = this.unsafeDirection(self, blast);
    // Passivity: at EASY, this decision has a real chance of skipping
    // target-chasing entirely -- a genuinely passive bot, not merely a
    // slow-and-sloppy one. Recovery (unsafe !== 0) always overrides this;
    // standing still off-stage is not "passive", it is falling to your
    // death, which is not the point.
    const passive = tuning.passiveChancePerMille > 0 && this.rollPerMille() < tuning.passiveChancePerMille;
    const target = passive ? null : this.pickTarget(sim, self);

    // --- Recovery / edge safety takes priority over everything else. ---
    if (unsafe !== 0) {
      stickX = unsafe;
      // Double jump for recovery: if airborne, still have a jump banked,
      // and either off the safe zone or sinking fast, use it — the only
      // other lever (DI via `unsafe`) is weak on its own, which is exactly
      // why bots used to lose stocks a human wouldn't. `requestJump` below
      // handles turning this into a real button-press edge.
      if (!self.grounded && self.jumpsUsed < MAX_JUMPS && self.velY < 0) {
        if (this.requestJump()) buttons |= BUTTON_JUMP;
      }
    } else {
      // --- Item seeking: closest reachable world item, if any. ---
      const itemTarget = this.findNearestWorldItem(sim, self);
      const heldItemSlot = this.findHeldItemSlot(sim);
      if (heldItemSlot >= 0) {
        // Holding an item: use it on a nearby target, same button as attack.
        if (target && this.inAttackRange(self, target)) {
          buttons |= BUTTON_ATTACK;
          stickX = signOf(fx.sub(target.posX, self.posX));
        } else if (target) {
          stickX = signOf(fx.sub(target.posX, self.posX));
        }
      } else if (itemTarget) {
        stickX = signOf(fx.sub(itemTarget.posX, self.posX));
      } else if (target) {
        const dx = fx.sub(target.posX, self.posX);
        const dy = fx.sub(target.posY, self.posY);
        stickX = signOf(dx);
        stickY = signOf(dy);
        if (this.inAttackRange(self, target) && this.rollPerMille() >= tuning.hesitationPerMille) {
          buttons |= BUTTON_ATTACK;
          // Aim: grounded jab/ftilt picked by |stickX| threshold in
          // sim.ts, airborne uair/dair picked by stickY sign — steer the
          // stick to request the appropriate move for the target's
          // relative position rather than always spamming forward-tilt.
          if (!self.grounded) {
            stickY = dy < 0 ? fx.neg(ONE) : ONE;
          } else if (fx.abs(dx) > fx.fromFloat(1.5)) {
            stickX = signOf(dx);
          } else {
            stickX = 0; // close-range: jab, not forward-tilt.
          }
        }
      }
    }

    // Occasional shield vs. an incoming close, active attacker — cheap
    // "defensive" behaviour: if someone else is mid-attack right next to
    // us on the ground, sometimes hold shield instead of always trading.
    // Kept rare (and slightly rarer than before) so fights keep moving
    // instead of stalling into shield-standoffs.
    if (unsafe === 0 && self.grounded && this.rollPerMille() < 25) {
      if (target && this.inAttackRange(self, target)) {
        buttons |= BUTTON_SHIELD;
        buttons &= ~BUTTON_ATTACK;
      }
    }

    // Jump to chase a target on a higher platform, close the last bit of
    // horizontal gap with an air approach, or escape a hazard overhead.
    // Also spend a banked double jump to close distance faster when a
    // target is nearby but not yet in range — keeps engagements moving
    // instead of a long ground walk-up every time.
    if (unsafe === 0 && self.grounded) {
      if (target && target.posY > fx.add(self.posY, fx.fromFloat(4.0)) && fx.abs(fx.sub(target.posX, self.posX)) < fx.fromFloat(20.0)) {
        buttons |= BUTTON_JUMP;
      }
      if (this.nearOverheadHazard(sim, self)) {
        buttons |= BUTTON_JUMP;
      }
    } else if (
      unsafe === 0 &&
      !self.grounded &&
      target &&
      self.jumpsUsed < MAX_JUMPS &&
      fx.abs(fx.sub(target.posX, self.posX)) > fx.fromFloat(6.0) &&
      !this.inAttackRange(self, target)
    ) {
      if (this.requestJump()) buttons |= BUTTON_JUMP;
    }

    // Imprecision: wobble the stick rather than the decision itself, so a
    // low-difficulty bot still tries to do the right thing, just sloppily.
    if (this.rollPerMille() < tuning.wobbleChancePerMille) {
      stickX = clampStick(fx.add(stickX, fx.mul(this.rollWobble(), tuning.wobbleMagnitude)));
      stickY = clampStick(fx.add(stickY, fx.mul(this.rollWobble(), tuning.wobbleMagnitude)));
    }

    return { buttons, stickX: clampStick(stickX), stickY: clampStick(stickY) };
  }

  /** Turns a desire to jump right now into a genuine button-press edge.
   * The sim only counts a jump on a 0->1 transition of the jump button
   * (`jumpEdge` in sim.ts); this.cached can hold the button pressed for
   * many ticks (decisions are infrequent), so pressing again while it's
   * already held would silently do nothing. If the last frame we emitted
   * already had the button down, release it for one tick (returning
   * false — caller omits the bit) and force an immediate re-decision so
   * the very next tick presses again and gets a fresh edge. */
  private requestJump(): boolean {
    const alreadyHeld = (this.cached.buttons & BUTTON_JUMP) !== 0;
    if (alreadyHeld) {
      this.decisionCooldown = 1;
      return false;
    }
    return true;
  }

  /** Picks the fighter to fight/flee, scoring by proximity but penalising
   * targets already crowded by other fighters (broken-up clumping) and
   * favouring the current target somewhat (stickiness, avoids flicker).
   * Periodically forces a fresh look even if the current target still
   * scores fine, so a match doesn't settle into fixed pairs for its whole
   * duration. */
  private pickTarget(sim: Sim, self: FighterSnapshot): (FighterSnapshot & { index: number }) | null {
    const candidates: (FighterSnapshot & { index: number })[] = [];
    for (let i = 0; i < sim.numFighters; i++) {
      if (i === this.fighterIndex) continue;
      const f = sim.getFighter(i);
      if (f.eliminated) continue;
      candidates.push({ ...f, index: i });
    }
    if (candidates.length === 0) {
      this.targetIndex = -1;
      return null;
    }

    // Cluster density around each candidate: how many *other* fighters
    // (excluding self and the candidate) sit within CLUSTER_RADIUS of it.
    // A candidate already surrounded scores worse, nudging idle bots
    // toward opponents elsewhere in the arena instead of piling on.
    const density = (c: FighterSnapshot & { index: number }): number => {
      let n = 0;
      for (const other of candidates) {
        if (other.index === c.index) continue;
        const dx = fx.toFloat(fx.sub(other.posX, c.posX));
        const dy = fx.toFloat(fx.sub(other.posY, c.posY));
        if (dx * dx + dy * dy <= CLUSTER_RADIUS_SQ) n++;
      }
      return n;
    };

    // Squared distance (plain float arithmetic — no sqrt/transcendental
    // calls, which packages/sim's lint rule forbids for determinism).
    // Ranking only needs a monotonic proxy for distance, so skipping the
    // sqrt is free; the other terms are scaled to match squared-distance
    // units (see CLUSTER_PENALTY/STICKINESS_BONUS_SQ comments).
    const distSqTo = (c: FighterSnapshot & { index: number }): number => {
      const dx = fx.toFloat(fx.sub(c.posX, self.posX));
      const dy = fx.toFloat(fx.sub(c.posY, self.posY));
      return dx * dx + dy * dy;
    };

    const tuning = TUNING[this.difficulty];
    const score = (c: FighterSnapshot & { index: number }): number => {
      const clusterMult = this.protectedIndices.has(c.index) ? tuning.protectedClusterMultiplier : 1.0;
      let s = distSqTo(c) + density(c) * CLUSTER_PENALTY * clusterMult;
      if (this.protectedIndices.has(c.index)) s += tuning.protectedTargetPenalty;
      if (c.index === this.targetIndex) s -= STICKINESS_BONUS;
      return s;
    };

    let best = candidates[0]!;
    let bestScore = score(best);
    for (let i = 1; i < candidates.length; i++) {
      const s = score(candidates[i]!);
      if (s < bestScore) {
        bestScore = s;
        best = candidates[i]!;
      }
    }

    // Force periodic re-rolls: even a "sticky" pair breaks up once the
    // lock expires, and if there is a genuinely different opponent
    // available we pick a *different* one than last time's target
    // (weighted-random among the top few, not just nearest) so 20 bots
    // don't converge onto the single globally-nearest pairing pattern.
    if (this.targetLockDecisions <= 0 && candidates.length > 1) {
      const sorted = candidates
        .map((c) => ({ c, s: score(c) }))
        .sort((a, b) => a.s - b.s)
        .slice(0, Math.min(3, candidates.length));
      const roll = this.rollPerMille() % sorted.length;
      best = sorted[roll]!.c;
      this.targetLockDecisions = TARGET_LOCK_DECISIONS + (this.rollPerMille() % 4);
    } else {
      this.targetLockDecisions -= 1;
    }

    if (best.index !== this.targetIndex) this.targetSwitchCount++;
    this.targetIndex = best.index;
    return best;
  }

  /** Returns -1/0/1 (fixed ONE units) for "move this way to stay inside the
   * current blast rect with a safety margin", or 0 if comfortably safe. */
  private unsafeDirection(
    self: FighterSnapshot,
    blast: { minX: Fixed; maxX: Fixed; minY: Fixed; maxY: Fixed },
  ): Fixed {
    if (self.posX < fx.add(blast.minX, EDGE_SAFETY_MARGIN)) return ONE;
    if (self.posX > fx.sub(blast.maxX, EDGE_SAFETY_MARGIN)) return fx.neg(ONE);
    if (self.posY < fx.add(blast.minY, EDGE_SAFETY_MARGIN)) {
      // Below the safe band (e.g. knocked down off a platform): steer back
      // toward center X so at least horizontal drift helps a recovery.
      return self.posX > 0 ? fx.neg(ONE) : ONE;
    }
    return 0;
  }

  private inAttackRange(self: FighterSnapshot, target: FighterSnapshot): boolean {
    return (
      fx.abs(fx.sub(target.posX, self.posX)) <= ATTACK_RANGE_X &&
      fx.abs(fx.sub(target.posY, self.posY)) <= ATTACK_RANGE_Y
    );
  }

  private findNearestWorldItem(sim: Sim, self: FighterSnapshot): { posX: Fixed; posY: Fixed } | null {
    let best: { posX: Fixed; posY: Fixed } | null = null;
    let bestDist = Number.POSITIVE_INFINITY;
    for (let slot = 0; slot < 8; slot++) {
      let item;
      try {
        item = sim.getItem(slot);
      } catch {
        break; // MAX_ITEMS reached
      }
      if (!item.active || item.state !== 0 /* WORLD */) continue;
      const dx = fx.toFloat(fx.sub(item.posX, self.posX));
      if (Math.abs(dx) > fx.toFloat(ITEM_SEEK_RANGE_X)) continue;
      const dist = dx * dx;
      if (dist < bestDist) {
        bestDist = dist;
        best = { posX: item.posX, posY: item.posY };
      }
    }
    return best;
  }

  private findHeldItemSlot(sim: Sim): number {
    for (let slot = 0; slot < 8; slot++) {
      let item;
      try {
        item = sim.getItem(slot);
      } catch {
        break;
      }
      if (item.active && item.state === 1 /* HELD */ && item.holder === this.fighterIndex) return slot;
    }
    return -1;
  }

  private nearOverheadHazard(sim: Sim, self: FighterSnapshot): boolean {
    for (let slot = 0; slot < 4; slot++) {
      let hz;
      try {
        hz = sim.getHazard(slot);
      } catch {
        break;
      }
      if (!hz.active) continue;
      if (fx.abs(fx.sub(hz.posX, self.posX)) < fx.fromFloat(2.0) && hz.posY > self.posY && hz.posY < fx.add(self.posY, fx.fromFloat(15.0))) {
        return true;
      }
    }
    return false;
  }
}

/** Deterministically derives a per-bot seed from the match seed and slot
 * index so every client (and every rerun of the same match seed) produces
 * the exact same bot decisions without needing to send bot RNG state over
 * the wire. */
export function deriveBotSeed(matchSeed: number, fighterIndex: number): number {
  return (matchSeed ^ Math.imul(fighterIndex + 1, 0x9e3779b1)) >>> 0;
}

const BOT_NAME_POOL = [
  'Nova',
  'Gizmo',
  'Rook',
  'Wisp',
  'Talon',
  'Cinder',
  'Bramble',
  'Fuzz',
  'Orbit',
  'Static',
  'Puck',
  'Kettle',
  'Junco',
  'Marble',
  'Pixel',
  'Grit',
  'Squall',
  'Ember',
  'Copper',
  'Vellum',
];

/** Plausible, human-scannable bot name — prefixed so it's never confused
 * with a real player's chosen name in the lobby list. */
export function botName(index: number): string {
  const name = BOT_NAME_POOL[index % BOT_NAME_POOL.length] ?? 'Bot';
  return `CPU ${name}`;
}
