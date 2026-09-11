// Shared computation behind scripts/spawn-clearance-audit.mjs and
// packages/content/test/spawn-clearance.test.ts -- kept as one function
// so the permanent regression test and the human-readable audit report
// can never drift apart. See wiki "Spawn Clearance Audit: All Stages
// 2026-09-11" for the full writeup of why this exists.
import * as fx from '../../../sim/src/math/fixed.ts';
import { computeSafeExtents } from '../../../sim/src/arena-shrink.ts';
import { computeKnockbackMagnitude } from '../../../sim/src/knockback.ts';
import { GRAVITY } from '../../../sim/src/sim.ts';
import { LUT_SIZE } from '../../../sim/src/math/fixed.ts';
import { ALL_CHARACTERS } from '../characters.ts';
import type { ArenaData } from '../../../sim/src/arena/types.ts';

export const HORIZ_SAFETY_FACTOR = 1.15;
export const VERT_SAFETY_FACTOR = 1.0;

export interface WorstArc {
  horiz: number;
  upHeight: number;
}

/** The worst-case arc a fresh (0%) fighter of the lightest weight in the
 * roster can be launched by the single hardest-hitting hitbox in the
 * whole roster, evaluated at tick=0 -- the earliest a hit can land, and
 * the softest point of EARLY_MATCH_KB_DAMPENER, so it is genuinely the
 * worst case rather than a mid-match one. */
export function computeWorstCaseArc(): WorstArc {
  const lightestWeight = Math.min(...ALL_CHARACTERS.map(c => fx.toFloat(c.character.weight)));
  let worstHoriz = 0;
  let worstUp = 0;
  for (const entry of ALL_CHARACTERS) {
    for (const move of entry.character.moves) {
      for (const window of move.windows) {
        for (const hb of window.hitboxes) {
          const dmg = fx.toFloat(hb.damage);
          const mag = fx.toFloat(computeKnockbackMagnitude(
            fx.fromFloat(dmg), fx.fromFloat(dmg),
            fx.fromFloat(fx.toFloat(hb.baseKnockback)),
            fx.fromFloat(fx.toFloat(hb.knockbackGrowth)),
            fx.fromFloat(lightestWeight), 0,
          ));
          const rad = (hb.angleIdx / LUT_SIZE) * 2 * Math.PI;
          const vx = mag * Math.cos(rad);
          const vy = mag * Math.sin(rad);
          const g = Math.abs(fx.toFloat(GRAVITY));
          const airTicks = vy > 0 ? (2 * vy) / g : 0;
          const horiz = Math.abs(vx * airTicks);
          const upHeight = vy > 0 ? (vy * vy) / (2 * g) : 0;
          if (horiz > worstHoriz) worstHoriz = horiz;
          if (upHeight > worstUp) worstUp = upHeight;
        }
      }
    }
  }
  return { horiz: worstHoriz, upHeight: worstUp };
}

export interface SpawnClearance {
  slot: number;
  x: number;
  y: number;
  horizClear: number;
  vertClear: number;
  horizFactor: number;
  vertFactor: number;
  shortfall: boolean;
}

/** Per-spawn clearance against the live tick-0, full-field-alive
 * boundary (the tightest the ring ever is before any shrink relaxation
 * from eliminations) -- this is the boundary a spawn is actually exposed
 * to in the opening seconds. */
export function computeStageClearance(arena: ArenaData, worst: WorstArc): SpawnClearance[] {
  const safe = computeSafeExtents(arena, 20, 20, 0);
  const minX = fx.toFloat(safe.minX), maxX = fx.toFloat(safe.maxX);
  const maxY = fx.toFloat(safe.maxY);
  return arena.spawnPoints.map((sp, i) => {
    const x = fx.toFloat(sp.x), y = fx.toFloat(sp.y);
    const horizClear = Math.min(x - minX, maxX - x);
    // Only the ceiling direction (clearUp) is reachable from a standing
    // spawn without first leaving the platform's own X range, which the
    // horizontal check already covers -- see arena-shrink comment in
    // spawn-clearance-audit.mjs for the full reasoning.
    const vertClear = maxY - y;
    const horizFactor = worst.horiz > 0 ? horizClear / worst.horiz : Infinity;
    const vertFactor = worst.upHeight > 0 ? vertClear / worst.upHeight : Infinity;
    const shortfall = horizFactor < HORIZ_SAFETY_FACTOR || vertFactor < VERT_SAFETY_FACTOR;
    return { slot: i, x, y, horizClear, vertClear, horizFactor, vertFactor, shortfall };
  });
}
