// Knockback model (Engine Architecture section 3): f(damage, target_percent,
// move_base_kb, move_kb_growth, target_weight) -> fixed-point magnitude,
// applied along an angle (mirrored by facing, adjusted by DI) to produce a
// velocity. Hitstun duration is proportional to that magnitude. Constants
// below are Bash Entertainment's own invented tuning, not Melee's.
import type { Fixed } from './math/fixed.ts';
import * as fx from './math/fixed.ts';
import { LUT_SIZE } from './math/fixed.ts';

// Heavier fighters take less knockback: weightTerm = WEIGHT_NUM / (weight + WEIGHT_OFFSET).
export const WEIGHT_NUM: Fixed = fx.fromInt(150);
export const WEIGHT_OFFSET: Fixed = fx.fromInt(50);
// Current percent contributes half its value on top of the raw hit damage
// when scaling knockback growth, mirroring genre convention that a fighter
// already damaged flies further from the same hit.
export const PERCENT_DIVISOR: Fixed = fx.fromInt(2);
// Ticks of hitstun per unit of knockback magnitude (magnitude is in the same
// units as velocity, e.g. ~1-20 for a typical hit).
export const HITSTUN_PER_MAGNITUDE: Fixed = fx.fromFloat(0.6);
export const MIN_HITSTUN_TICKS = 2;
export const MAX_HITSTUN_TICKS = 240;

// Uniform multiplier on the *percent-scaled* portion of knockback only
// (never on baseKnockback). Applied identically to every character, so the
// authored per-move base/growth numbers and the existing weight-based
// scaling (150/(weight+50)) keep the roster's relative spread (light
// fighters still fly further than heavy ones, in the same ratio as before)
// -- this only raises how hard a landed, percent-scaled hit finishes
// someone, so combat can end matches before the ring does. 1.3 chosen as
// a moderate first step: see wiki page "Bot Combat Engagement Fix
// 2026-09-09" follow-up for before/after measurement.
// 2026-09-09: tried 1.3 to raise combat share; reverted to 1.0 by owner
// decision -- it bought ~3pp of combat share (inside measurement noise)
// at the cost of stalemate timeouts on two of three stages and a
// suspected rise in final-two double-KOs. See wiki "Ring Pressure Not
// Executioner: 2026-09-09 Rebalance" for the measurements. Left in place
// as a named lever (rather than removed outright) so future lethality
// tuning has one clear place to change, but do not raise it again without
// the final-two double-KO metric in place first.
// PACING REWORK 2026-09-10, LEVER 3 (see wiki "Match Pacing Rework"):
// lowered from 1.0 to 0.75. Prior passes only tried *raising* this (1.3,
// reverted for stalemates/double-KOs). Production evidence this pass shows
// matches ending almost entirely by combat inside ~30s with essentially no
// middle game, so this pass tries the opposite direction: fewer knockback
// units per point of damage means more hits are needed to finish a fighter,
// which should extend individual fights (a real middle game) rather than
// just delaying when they start (see Lever 2, spawn spacing). Measured via
// production journalctl, one lever at a time -- see wiki page for the
// keep/revert decision and numbers.
// PACING REWORK 2026-09-10, LEVER 7 (match-arc lengthening pass): lowered
// again from 0.75 to 0.6. Live-play evidence this pass (see wiki "Match
// Arc Lengthening Pass 2026-09-10") shows matches still resolving in
// 44-70s against a 150-180s target even with the 8-minute ring clock and
// the 0.75 scale/early dampener from prior passes -- the ring is not the
// bottleneck, individual fights ending too fast is. Lowering the fraction
// of damage/percent that converts into knockback growth means more
// exchanges are needed to build enough magnitude to launch a fighter off
// -stage, which directly lengthens fights without changing the damage
// percent a player sees per hit.
export const KB_GROWTH_SCALE: Fixed = fx.fromFloat(0.6);

// STRUCTURAL PACING LEVER (2026-09-10, see wiki "Match Pacing Rework
// 2026-09-10 Pass 3" and "Bot Difficulty Correction and Human-Survival
// Fix 2026-09-10"): every prior pass tuned constants (spacing,
// KB_GROWTH_SCALE, retarget cooldown, shrink ceiling) and plateaued
// around ~50s average / ~79s best against a 150-180s target, with
// run-to-run variance as large as any single lever's effect. Pass 3's
// own recommendation was a structural change rather than another
// constant nudge: this is that change.
//
// EARLY_MATCH_KB_DAMPENER softens knockback magnitude only, only for the
// first EARLY_MATCH_RAMP_TICKS of a match, ramping linearly back to 1.0x
// by the end of the window. It does not touch damage percent (so the
// percent race is unaffected) and it does not touch EASY's existing
// protection logic (bot.ts) at all -- this is a combat-model change,
// applied identically regardless of who is hit.
//
// Why knockback and not damage: damage percent is also what a player
// reads as progress, so half-damaging the opening would make early hits
// feel like they don't matter. Softening knockback keeps every early
// hit visibly connecting (same damage, slightly less hitstun) but stops
// the opening scrum from converting its first exchange directly into
// blast-zone kills -- which is what was collapsing the match into a
// single ~20-30s trade. As the window ends, full knockback returns and
// the middle/endgame plays exactly as before.
// PACING REWORK 2026-09-10, LEVER 8: widened the early-game dampener --
// start lower (0.45 -> 0.35) and ramp back to full over a minute instead
// of 30s (1800 -> 3600 ticks). The opening scrum was still converting
// into the first eliminations well inside a minute; a longer, deeper
// soft-start buys more of the "many fighters still alive, jockeying"
// phase the owner's 150-180s target arc describes before the first kills
// land, without touching damage percent at all.
export const EARLY_MATCH_KB_DAMPENER_START = fx.fromFloat(0.35);
export const EARLY_MATCH_RAMP_TICKS = 3600; // 60s @ 60Hz

/** 0.45x at tick 0, ramping linearly to 1.0x at EARLY_MATCH_RAMP_TICKS and
 * beyond. Pure function of tick -- safe from both server and client sims,
 * determinism-preserving (same tick in, same scale out). */
export function earlyMatchKnockbackScale(tick: number): Fixed {
  if (tick >= EARLY_MATCH_RAMP_TICKS) return fx.fromInt(1);
  if (tick <= 0) return EARLY_MATCH_KB_DAMPENER_START;
  const progress = fx.div(fx.fromInt(tick), fx.fromInt(EARLY_MATCH_RAMP_TICKS));
  const range = fx.sub(fx.fromInt(1), EARLY_MATCH_KB_DAMPENER_START);
  return fx.add(EARLY_MATCH_KB_DAMPENER_START, fx.mul(range, progress));
}

/** magnitude = (baseKb + KB_GROWTH_SCALE * kbGrowth * (damage + percentAfterHit / 2) * (150 / (weight + 50))) * earlyMatchKnockbackScale(tick) */
export function computeKnockbackMagnitude(
  damage: Fixed,
  percentAfterHit: Fixed,
  baseKnockback: Fixed,
  knockbackGrowth: Fixed,
  weight: Fixed,
  tick: number = EARLY_MATCH_RAMP_TICKS,
): Fixed {
  const weightTerm = fx.div(WEIGHT_NUM, fx.add(weight, WEIGHT_OFFSET));
  const percentTerm = fx.add(damage, fx.div(percentAfterHit, PERCENT_DIVISOR));
  const scaled = fx.mul(fx.mul(knockbackGrowth, percentTerm), KB_GROWTH_SCALE);
  const raw = fx.add(baseKnockback, fx.mul(scaled, weightTerm));
  return fx.mul(raw, earlyMatchKnockbackScale(tick));
}

export function computeHitstunTicks(magnitude: Fixed): number {
  const ticks = fx.toInt(fx.mul(magnitude, HITSTUN_PER_MAGNITUDE));
  if (ticks < MIN_HITSTUN_TICKS) return MIN_HITSTUN_TICKS;
  if (ticks > MAX_HITSTUN_TICKS) return MAX_HITSTUN_TICKS;
  return ticks;
}

/** Mirror an angle index horizontally (flip X, keep Y) for an attacker
 * facing left, so authored hitbox angles are always written as if facing
 * right. */
export function mirrorAngleIdx(angleIdx: number): number {
  const half = LUT_SIZE / 2;
  const m = (half - angleIdx) % LUT_SIZE;
  return m < 0 ? m + LUT_SIZE : m;
}

// Directional influence used to be a one-shot angle nudge applied at the
// instant of the hit. It is now continuous instead: see
// HITSTUN_DI_ACCEL_PER_TICK and GROUND_FRICTION in sim.ts, applied every
// tick of hitstun directly to velocity based on the defender's current
// stick input, so DI curves the whole trajectory rather than being baked
// in once.
