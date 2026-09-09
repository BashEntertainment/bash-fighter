// Deterministic arena-shrink schedule (owner decision 2026-09-07: default
// battle-royale mode needs the blast zone to close in as the field thins,
// so surviving fighters are forced together instead of idling in a huge
// arena). Pure function of (tick, aliveCount, N, arena, settings) — no
// wall-clock time, no client-local randomness — so it is fully replayable
// and its *result* is stored back into sim state each tick (see
// CURRENT_BLAST_* words in sim.ts) so save/load carries it exactly, rather
// than being a rendering-only effect recomputed from scratch by a client.
import type { Fixed } from './math/fixed.ts';
import * as fx from './math/fixed.ts';
import type { ArenaData } from './arena/types.ts';
import type { MatchSettings } from './match-settings.ts';

export interface BlastRect {
  minX: Fixed;
  maxX: Fixed;
  minY: Fixed;
  maxY: Fixed;
}

/** How far the *final* (fully shrunk) blast rectangle sits inside the
 * arena's initial one, as a fraction of each half-extent.
 *
 * Raised from 0.55 to 0.65 on 2026-09-09 (see [[Arena Collapse Cascade: Why
 * Matches End With Nobody Left 2026-09-09]]): at 0.55 the fully-closed
 * rectangle cut into standing ground on all three arenas (worst case
 * the-undercroft, ~208 units of each floor half turned lethal; even
 * the-spire's narrow +/-220 main platform lost its outer 11 units). At
 * 0.65 the-spire's platform is fully contained (0.65 * 380 = 247 > 220,
 * so the ring never reaches its ground at all), and the other two
 * arenas still leave several hundred units of solid floor for a
 * late-game handful of survivors even though the ring no longer spans
 * the full original platform. See
 * packages/sim/test/arena-shrink.test.ts for the per-arena
 * ground-overlap checks this constant must keep satisfying. */
const FINAL_SHRINK_FRACTION: Fixed = fx.fromFloat(0.65);

/** Weight given to the elimination-driven term. Kept deliberately small:
 * before 2026-09-09 the elimination term could reach full weight (1.0)
 * and directly race the clock via max(tickT, aliveT), which made the
 * shrink a positive feedback loop -- a death tightens the ring, the
 * tighter ring kills more fighters, which tightens the ring further. A
 * burst of near-simultaneous eliminations (up to and including
 * "everyone left dies on the same frame") can now only ever add up to
 * ALIVE_WEIGHT of extra progress in a single tick, on top of whatever
 * the clock already contributed -- never a full jump to "ring closed".
 * The clock (tickT) is left to dominate the pacing; eliminations only
 * pull the close-in forward a little, which still rewards aggressive
 * play without being able to feed on its own output. */
const ALIVE_WEIGHT: Fixed = fx.fromFloat(0.15);

function lerp(a: Fixed, b: Fixed, t: Fixed): Fixed {
  // a + (b - a) * t, all fixed-point, t in [0, ONE].
  return fx.add(a, fx.mul(fx.sub(b, a), t));
}

/** progress in [0, ONE]: a tick-driven "hazard storm" clock, plus a small
 * elimination-driven bonus on top. Monotonic in both tick and
 * eliminations — the arena never re-expands.
 *
 * Before 2026-09-09 this returned max(tickT, aliveT), letting the
 * elimination term alone drive the ring all the way to fully-closed (see
 * [[Arena Collapse Cascade: Why Matches End With Nobody Left 2026-09-09]]).
 * That is a positive feedback loop: eliminations tighten the ring, the
 * tighter ring crosses more standing ground and kills more fighters,
 * which tightens the ring again — twenty-player matches were ending in
 * under a minute, occasionally with a simultaneous double (or worse)
 * elimination wiping the whole field on one tick. Now the clock alone
 * can reach full progress, and the elimination term can only ever add
 * up to ALIVE_WEIGHT on top of that — bounded regardless of how many
 * fighters go out on the same tick, so a mass-elimination burst nudges
 * the ring instead of slamming it shut. */
export function computeShrinkProgress(
  tick: number,
  aliveCount: number,
  fighterCount: number,
  settings: MatchSettings,
): Fixed {
  if (!settings.arenaShrink) return 0;
  const tickDenom = settings.shrinkFullyClosedTick > 0 ? settings.shrinkFullyClosedTick : 1;
  const tickT = fx.clamp(fx.div(fx.fromInt(Math.min(tick, tickDenom)), fx.fromInt(tickDenom)), 0, fx.ONE);
  const aliveDenom = fighterCount > 1 ? fighterCount - 1 : 1;
  const eliminated = fighterCount - aliveCount;
  const aliveT = fx.clamp(fx.div(fx.fromInt(Math.min(eliminated, aliveDenom)), fx.fromInt(aliveDenom)), 0, fx.ONE);
  const bonus = fx.mul(ALIVE_WEIGHT, aliveT);
  return fx.clamp(fx.add(tickT, bonus), 0, fx.ONE);
}

export function computeCurrentBlastRect(
  arena: ArenaData,
  tick: number,
  aliveCount: number,
  fighterCount: number,
  settings: MatchSettings,
): BlastRect {
  const progress = computeShrinkProgress(tick, aliveCount, fighterCount, settings);
  const halfW = fx.div(fx.sub(arena.blastMaxX, arena.blastMinX), fx.fromInt(2));
  const halfH = fx.div(fx.sub(arena.blastMaxY, arena.blastMinY), fx.fromInt(2));
  const centerX = fx.div(fx.add(arena.blastMaxX, arena.blastMinX), fx.fromInt(2));
  const centerY = fx.div(fx.add(arena.blastMaxY, arena.blastMinY), fx.fromInt(2));
  const finalHalfW = fx.mul(halfW, FINAL_SHRINK_FRACTION);
  const finalHalfH = fx.mul(halfH, FINAL_SHRINK_FRACTION);
  const curHalfW = lerp(halfW, finalHalfW, progress);
  const curHalfH = lerp(halfH, finalHalfH, progress);
  return {
    minX: fx.sub(centerX, curHalfW),
    maxX: fx.add(centerX, curHalfW),
    minY: fx.sub(centerY, curHalfH),
    maxY: fx.add(centerY, curHalfH),
  };
}
