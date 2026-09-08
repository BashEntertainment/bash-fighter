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
 * arena's initial one, as a fraction of each half-extent. 0.55 leaves a
 * comfortably small but not point-sized final ring. */
const FINAL_SHRINK_FRACTION: Fixed = fx.fromFloat(0.55);

function lerp(a: Fixed, b: Fixed, t: Fixed): Fixed {
  // a + (b - a) * t, all fixed-point, t in [0, ONE].
  return fx.add(a, fx.mul(fx.sub(b, a), t));
}

/** progress in [0, ONE]: the maximum of a tick-driven "hazard storm" clock
 * and an alive-count-driven closing ring. Monotonic in both tick and
 * eliminations — the arena never re-expands. */
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
  return tickT > aliveT ? tickT : aliveT;
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
