// Pure "camera framing floor" geometry, extracted out of index.ts's
// framingFloor() (issue: packages/render test coverage pass 2026-09-12) so
// it can be unit-tested without pulling in Pixi/DOM. Behaviour is
// unchanged -- index.ts's framingFloor() is now a thin re-export of this
// module. See computeFramingFloor's doc comment below for what it does
// and why (moved verbatim from the original framingFloor()).
import type { ArenaBounds } from './camera.ts';

/** Only the StageBounds fields this module actually reads. Defined
 * locally (rather than importing the full StageBounds from stage.ts) so
 * this module has zero Pixi/DOM dependency -- stage.ts imports
 * pixi.js's Graphics at module scope. */
export interface FramingStageBounds {
  platforms: readonly { minX: number; maxX: number; y: number }[];
  blastMinX: number;
  blastMaxX: number;
  blastMinY: number;
  blastMaxY: number;
}

// How far above the tallest platform / below the ground a fighter can
// still meaningfully go (double-jump apex, a hard landing) and therefore
// still needs to stay on screen. Derived from packages/sim's jump
// constants (JUMP_VELOCITY/DOUBLE_JUMP_VELOCITY vs GRAVITY give an apex
// a little under 200 world units above a jump's start), not guessed --
// rounded up for headroom. This is presentation framing only; it never
// changes where a fighter can actually stand or die.
export const JUMP_HEADROOM_WORLD = 200;
export const FALL_HEADROOM_WORLD = 90;

/** The camera's "always show at least this much" floor used to be the
 * *entire* blast zone -- a battle-royale arena's blast zone is sized with
 * a huge margin above/below the platforms specifically so a shrinking
 * arena has room to close (see battle-royale-20/data.ts), which meant
 * the baseline camera permanently framed a stage-sized band of empty sky
 * and empty pit that no fighter ever legibly occupies. The actual
 * fought-over space is the platforms plus enough headroom to see a jump
 * or a hard fall coming -- that is what the camera should never zoom
 * tighter than. Intersected with the *live* (possibly shrunk) blast rect
 * so the floor honestly shrinks as the collapsing arena does, instead of
 * permanently reserving room for a blast zone that no longer exists. */
export function computeFramingFloor(
  stage: FramingStageBounds,
  viewWidth: number,
  viewHeight: number,
): ArenaBounds {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of stage.platforms) {
    minX = Math.min(minX, p.minX);
    maxX = Math.max(maxX, p.maxX);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }
  if (!Number.isFinite(minX)) {
    // No platform data (e.g. a bare test fixture) -- fall back to the
    // full blast rect rather than an empty/inverted floor.
    return { minX: stage.blastMinX, maxX: stage.blastMaxX, minY: stage.blastMinY, maxY: stage.blastMaxY };
  }
  minY -= FALL_HEADROOM_WORLD;
  maxY += JUMP_HEADROOM_WORLD;

  // Never claim more than the live blast rect actually covers -- this is
  // what makes the floor shrink correctly as the collapsing arena closes
  // in, rather than permanently framing the arena's original footprint.
  // This must happen BEFORE the aspect-ratio correction below, not after:
  // clamping post-hoc cuts whichever side sticks out past the live blast
  // rect (independently per edge) without touching the opposite edge,
  // which silently breaks the aspect match the padding step below just
  // established and re-centers the box off the actual fought-over space --
  // this was the real cause of the reported dead-space/off-center bug on
  // stages whose headroom box pokes past a shrunk blast rect on only one
  // side (e.g. the fall-headroom band below the ground going past
  // blastMinY as the ring closes, while the jump-headroom band above
  // stays inside it, pulling the framed box's center upward and leaving a
  // dead band at the bottom of the screen).
  minX = Math.max(minX, stage.blastMinX);
  maxX = Math.min(maxX, stage.blastMaxX);
  minY = Math.max(minY, stage.blastMinY);
  maxY = Math.min(maxY, stage.blastMaxY);

  // The "fought-over space plus jump/fall headroom" box computed above
  // (now also clamped to the live blast rect) has whatever aspect ratio
  // the stage's own geometry happens to produce, which on every current
  // stage does not match the viewport's (see wiki "Camera Framing and
  // Start Screen Composition 2026-09-10"): battle-royale-20 and
  // the-undercroft are wide relative to their headroom (viewport ends up
  // X-bound, leaving a dead band above or below the action), while
  // the-spire is comparatively tall (viewport ends up Y-bound, leaving
  // dead bands left and right). Pad whichever axis is short so the box's
  // aspect ratio matches the viewport's before it is ever handed to
  // computeCamera -- that is what actually fills the screen with the
  // arena instead of leaving letterboxing, without ever changing what a
  // fighter can reach (presentation only). Vertical padding keeps the
  // existing fall:jump ratio (a hard landing needs less warning room
  // than a rising jump); horizontal padding is split evenly since
  // there's no equivalent asymmetry left-to-right. This step is allowed
  // to grow the box back past the live blast rect on the padded axis --
  // that only ever shows a little more of the (still physically present)
  // stage floor/void, never invents geometry, and a correctly-filled,
  // correctly-centered frame matters more than never drawing a pixel
  // beyond the ring.
  const viewportAspect = viewWidth / viewHeight;
  const spanX = maxX - minX;
  const spanY = maxY - minY;
  const naturalAspect = spanX / spanY;
  if (naturalAspect > viewportAspect) {
    // Wider than the viewport needs -- the viewport will be X-bound;
    // grow the vertical span to match so there's no dead band top/bottom.
    const desiredSpanY = spanX / viewportAspect;
    const extra = Math.max(0, desiredSpanY - spanY);
    const fallShare = FALL_HEADROOM_WORLD / (FALL_HEADROOM_WORLD + JUMP_HEADROOM_WORLD);
    minY -= extra * fallShare;
    maxY += extra * (1 - fallShare);
  } else if (naturalAspect < viewportAspect) {
    // Taller than the viewport needs -- the viewport will be Y-bound;
    // grow the horizontal span to match so there's no dead band left/right.
    const desiredSpanX = spanY * viewportAspect;
    const extra = Math.max(0, desiredSpanX - spanX);
    minX -= extra / 2;
    maxX += extra / 2;
  }

  return { minX, maxX, minY, maxY };
}
