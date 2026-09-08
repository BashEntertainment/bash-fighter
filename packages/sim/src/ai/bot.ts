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
}

const TUNING: Record<BotDifficultyValue, DifficultyTuning> = {
  [BotDifficulty.EASY]: {
    reactionTicks: 24, // 400ms
    reactionJitterTicks: 10,
    wobbleChancePerMille: 350,
    wobbleMagnitude: fx.fromFloat(0.6),
    hesitationPerMille: 300,
  },
  [BotDifficulty.MEDIUM]: {
    reactionTicks: 14, // ~230ms
    reactionJitterTicks: 6,
    wobbleChancePerMille: 180,
    wobbleMagnitude: fx.fromFloat(0.35),
    hesitationPerMille: 120,
  },
  [BotDifficulty.HARD]: {
    reactionTicks: 6, // 100ms
    reactionJitterTicks: 3,
    wobbleChancePerMille: 60,
    wobbleMagnitude: fx.fromFloat(0.15),
    hesitationPerMille: 30,
  },
};

const ATTACK_RANGE_X: Fixed = fx.fromFloat(3.0);
const ATTACK_RANGE_Y: Fixed = fx.fromFloat(3.0);
const ITEM_SEEK_RANGE_X: Fixed = fx.fromFloat(60.0);
/** How close (fixed units) to the current, possibly-shrunk blast rect edge
 * before the bot treats "stand your ground" as unsafe and prioritises
 * moving inward over anything else — chasing a target or an item. */
const EDGE_SAFETY_MARGIN: Fixed = fx.fromFloat(18.0);
const ONE = fx.ONE;

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

  /**
   * @param seed Deterministic per-bot seed. Callers should derive this from
   *   the match seed and fighterIndex (e.g. `matchSeed ^ (fighterIndex * 0x9e3779b1)`)
   *   so a rerun of the same match seed reproduces the same bot decisions.
   */
  constructor(fighterIndex: number, difficulty: BotDifficultyValue, seed: number) {
    this.fighterIndex = fighterIndex;
    this.difficulty = difficulty;
    this.rng = seedRng(seed);
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

    // --- Recovery / edge safety takes priority over everything else. ---
    if (unsafe !== 0) {
      stickX = unsafe;
      if (self.grounded && (self.velX === 0 || signOf(self.velX) !== unsafe)) {
        // Nudge toward center; jump only helps if there is something to
        // jump onto, which we can't easily tell here, so stay grounded and
        // run — clampToPlatform keeps a grounded bot from walking off a
        // platform it's already standing on.
      }
      if (!self.grounded && self.velY < 0) {
        // Falling and off the safe zone: no double jump exists in this
        // sim, so the only lever is DI (stick) toward the stage, already
        // set above via `unsafe`.
      }
    } else {
      // --- Item seeking: closest reachable world item, if any. ---
      const itemTarget = this.findNearestWorldItem(sim, self);
      const heldItemSlot = this.findHeldItemSlot(sim);
      if (heldItemSlot >= 0) {
        // Holding an item: use it on a nearby target, same button as attack.
        const target = this.findNearestTarget(sim);
        if (target && this.inAttackRange(self, target)) {
          buttons |= BUTTON_ATTACK;
          stickX = signOf(fx.sub(target.posX, self.posX));
        } else if (target) {
          stickX = signOf(fx.sub(target.posX, self.posX));
        }
      } else if (itemTarget) {
        stickX = signOf(fx.sub(itemTarget.posX, self.posX));
      } else {
        const target = this.findNearestTarget(sim);
        if (target) {
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
          } else if (!self.grounded && dy > fx.fromFloat(2.0) && self.grounded === false) {
            // Airborne and target well below: no special action, just
            // drift down toward them via normal gravity + stickX chase.
          }
        }
      }
    }

    // Occasional shield vs. an incoming close, active attacker — cheap
    // "defensive" behaviour: if someone else is mid-attack right next to
    // us on the ground, sometimes hold shield instead of always trading.
    if (unsafe === 0 && self.grounded && this.rollPerMille() < 40) {
      const threat = this.findNearestTarget(sim);
      if (threat && this.inAttackRange(self, threat)) {
        buttons |= BUTTON_SHIELD;
        buttons &= ~BUTTON_ATTACK;
      }
    }

    // Jump to chase a target on a higher platform, or to escape a hazard
    // directly overhead.
    if (unsafe === 0 && self.grounded) {
      const target = this.findNearestTarget(sim);
      if (target && target.posY > fx.add(self.posY, fx.fromFloat(4.0)) && fx.abs(fx.sub(target.posX, self.posX)) < fx.fromFloat(20.0)) {
        buttons |= BUTTON_JUMP;
      }
      if (this.nearOverheadHazard(sim, self)) {
        buttons |= BUTTON_JUMP;
      }
    }

    // Imprecision: wobble the stick rather than the decision itself, so a
    // low-difficulty bot still tries to do the right thing, just sloppily.
    if (this.rollPerMille() < tuning.wobbleChancePerMille) {
      stickX = clampStick(fx.add(stickX, fx.mul(this.rollWobble(), tuning.wobbleMagnitude)));
      stickY = clampStick(fx.add(stickY, fx.mul(this.rollWobble(), tuning.wobbleMagnitude)));
    }

    return { buttons, stickX: clampStick(stickX), stickY: clampStick(stickY) };
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

  private findNearestTarget(sim: Sim): FighterSnapshot & { index: number } {
    const self = sim.getFighter(this.fighterIndex);
    let best: (FighterSnapshot & { index: number }) | null = null;
    let bestDist = Number.POSITIVE_INFINITY;
    for (let i = 0; i < sim.numFighters; i++) {
      if (i === this.fighterIndex) continue;
      const f = sim.getFighter(i);
      if (f.eliminated) continue;
      const dx = fx.toFloat(fx.sub(f.posX, self.posX));
      const dy = fx.toFloat(fx.sub(f.posY, self.posY));
      const dist = dx * dx + dy * dy;
      if (dist < bestDist) {
        bestDist = dist;
        best = { ...f, index: i };
      }
    }
    return best as FighterSnapshot & { index: number };
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
