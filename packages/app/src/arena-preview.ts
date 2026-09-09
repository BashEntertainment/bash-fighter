// Derives the current and future blast-zone rectangles for the renderer.
// Both come from the same pure, deterministic function the sim itself
// uses (packages/sim/src/arena-shrink.ts's computeCurrentBlastRect) --
// this file adds no shrink logic of its own, it just calls that function
// twice (once at the real tick, once at tick+lookahead) so the render
// layer can draw "where the boundary is" and "where it's headed"
// without the sim ever being asked to report a second rectangle. Reading
// a pure function of (tick, aliveCount, fighterCount, settings) forward
// in time is safe precisely because it takes no wall-clock or
// client-local randomness -- see the comment atop arena-shrink.ts.
import {
  computeCurrentBlastRect,
  fixed as fx,
  type ArenaData,
  type MatchSettings,
} from '@bash-fighter/sim';
import type { ArenaBounds } from '@bash-fighter/render';

// How far ahead to preview, in ticks. 180 ticks at the sim's fixed 60Hz
// cadence is 3 seconds -- enough for a player to notice, decide, and
// move before the real boundary reaches where the preview line is now,
// but short enough that the preview band stays a believable near-term
// warning rather than a vague long-range forecast.
export const PREVIEW_LOOKAHEAD_TICKS = 180;

function toArenaBounds(rect: { minX: fx.Fixed; maxX: fx.Fixed; minY: fx.Fixed; maxY: fx.Fixed }): ArenaBounds {
  return {
    minX: fx.toFloat(rect.minX),
    maxX: fx.toFloat(rect.maxX),
    minY: fx.toFloat(rect.minY),
    maxY: fx.toFloat(rect.maxY),
  };
}

/** Current blast rect as ArenaBounds floats, for RenderFrame.liveArenaBounds. */
export function currentArenaBounds(rect: {
  minX: fx.Fixed;
  maxX: fx.Fixed;
  minY: fx.Fixed;
  maxY: fx.Fixed;
}): ArenaBounds {
  return toArenaBounds(rect);
}

/** Blast rect at tick + PREVIEW_LOOKAHEAD_TICKS, for
 * RenderFrame.previewArenaBounds. `aliveCount` must be the count *right
 * now* (not projected) -- computeShrinkProgress already takes the max of
 * the tick-driven and alive-count-driven terms, so projecting the tick
 * forward while holding today's alive count still gives a correct lower
 * bound on the future boundary: if more fighters are eliminated before
 * then, the real boundary will have shrunk at least this much, never
 * less. */
export function previewArenaBounds(
  arena: ArenaData,
  tick: number,
  aliveCount: number,
  fighterCount: number,
  settings: MatchSettings,
): ArenaBounds {
  const rect = computeCurrentBlastRect(arena, tick + PREVIEW_LOOKAHEAD_TICKS, aliveCount, fighterCount, settings);
  return toArenaBounds(rect);
}
