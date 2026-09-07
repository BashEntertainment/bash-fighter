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

/** magnitude = baseKb + kbGrowth * (damage + percentAfterHit / 2) * (150 / (weight + 50)) */
export function computeKnockbackMagnitude(
  damage: Fixed,
  percentAfterHit: Fixed,
  baseKnockback: Fixed,
  knockbackGrowth: Fixed,
  weight: Fixed,
): Fixed {
  const weightTerm = fx.div(WEIGHT_NUM, fx.add(weight, WEIGHT_OFFSET));
  const percentTerm = fx.add(damage, fx.div(percentAfterHit, PERCENT_DIVISOR));
  const scaled = fx.mul(knockbackGrowth, percentTerm);
  return fx.add(baseKnockback, fx.mul(scaled, weightTerm));
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
