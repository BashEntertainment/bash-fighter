// Unit tests for packages/render/src/framing.ts's computeFramingFloor(),
// extracted from index.ts's framingFloor() (packages/render test coverage
// pass 2026-09-12) precisely so this pure geometry can be exercised
// without Pixi/DOM. Behaviour must be byte-for-byte identical to the
// pre-extraction function -- index.ts's framingFloor() is now a thin
// wrapper around this. Same node:test + node:assert style as
// camera.test.ts / badge-layout.test.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeFramingFloor,
  JUMP_HEADROOM_WORLD,
  FALL_HEADROOM_WORLD,
  type FramingStageBounds,
} from '../src/framing.ts';

const EPS = 1e-9;

function flatStage(overrides: Partial<FramingStageBounds> = {}): FramingStageBounds {
  return {
    platforms: [{ minX: -300, maxX: 300, y: 0 }],
    blastMinX: -1000,
    blastMaxX: 1000,
    blastMinY: -800,
    blastMaxY: 800,
    ...overrides,
  };
}

test('no platform data falls back to the full blast rect, not an empty/inverted box', () => {
  const stage: FramingStageBounds = {
    platforms: [],
    blastMinX: -500,
    blastMaxX: 500,
    blastMinY: -400,
    blastMaxY: 400,
  };
  const floor = computeFramingFloor(stage, 1280, 720);
  assert.equal(floor.minX, -500);
  assert.equal(floor.maxX, 500);
  assert.equal(floor.minY, -400);
  assert.equal(floor.maxY, 400);
});

test('single flat platform: floor hugs the platform plus fall/jump headroom, not the whole blast zone', () => {
  const stage = flatStage();
  const floor = computeFramingFloor(stage, 1280, 720);
  // Platform spans -300..300 at y=0. Raw (pre-aspect-correction) box would
  // be minY = 0 - FALL_HEADROOM_WORLD, maxY = 0 + JUMP_HEADROOM_WORLD --
  // both comfortably inside the +/-800 blast rect, so clamping doesn't
  // engage on Y. The floor must never simply equal the full blast rect.
  assert.ok(floor.maxY - floor.minY < 800 * 2, 'must be tighter than full blast height');
  assert.ok(floor.minY <= -FALL_HEADROOM_WORLD + EPS, 'keeps fall headroom below the ground');
  assert.ok(floor.maxY >= JUMP_HEADROOM_WORLD - EPS, 'keeps jump headroom above the ground');
});

test('result box aspect ratio always matches the viewport aspect ratio', () => {
  for (const [vw, vh] of [[1280, 720], [1920, 1080], [390, 844], [800, 800]] as const) {
    const floor = computeFramingFloor(flatStage(), vw, vh);
    const boxAspect = (floor.maxX - floor.minX) / (floor.maxY - floor.minY);
    const viewportAspect = vw / vh;
    assert.ok(
      Math.abs(boxAspect - viewportAspect) < 1e-6,
      `box aspect ${boxAspect} should match viewport aspect ${viewportAspect} (vw=${vw},vh=${vh})`,
    );
  }
});

test('a wide/flat stage (headroom box wider than the viewport wants) pads vertically, keeping X untouched', () => {
  // A very wide platform relative to its headroom band forces
  // naturalAspect > viewportAspect, so the function should grow Y and
  // leave X exactly as clamped (no horizontal padding).
  const stage = flatStage({ platforms: [{ minX: -2000, maxX: 2000, y: 0 }], blastMinX: -2500, blastMaxX: 2500 });
  const floor = computeFramingFloor(stage, 1280, 720);
  assert.equal(floor.minX, -2000);
  assert.equal(floor.maxX, 2000);
  assert.ok(floor.maxY - floor.minY > JUMP_HEADROOM_WORLD + FALL_HEADROOM_WORLD, 'Y padded beyond raw headroom');
});

test('a tall/narrow stage (headroom box taller than the viewport wants) pads horizontally evenly, keeping Y untouched', () => {
  // A very narrow platform means the raw box is much taller (relatively)
  // than the viewport, so naturalAspect < viewportAspect and X gets
  // padded evenly (extra/2 each side), Y left as clamped.
  const stage = flatStage({ platforms: [{ minX: -10, maxX: 10, y: 0 }] });
  const floor = computeFramingFloor(stage, 1280, 720);
  assert.equal(floor.minY, -FALL_HEADROOM_WORLD);
  assert.equal(floor.maxY, JUMP_HEADROOM_WORLD);
  // Symmetric padding around the platform's own center (0).
  assert.ok(Math.abs(floor.minX + floor.maxX) < EPS, 'X padding should stay symmetric around the platform center');
  assert.ok(floor.maxX - floor.minX > 20, 'X should have been padded well past the bare 20-unit platform span');
});

test('shrinking blast rect (collapsing arena) clamps the floor down, honestly shrinking with it', () => {
  const wideBlast = computeFramingFloor(flatStage({ blastMinX: -1000, blastMaxX: 1000, blastMinY: -800, blastMaxY: 800 }), 1280, 720);
  const shrunk = computeFramingFloor(
    flatStage({ blastMinX: -250, blastMaxX: 250, blastMinY: -100, blastMaxY: 150 }),
    1280,
    720,
  );
  assert.ok(shrunk.maxX - shrunk.minX <= wideBlast.maxX - wideBlast.minX, 'shrunk floor must not be wider than the un-shrunk one');
  assert.ok(shrunk.maxX <= 250 + EPS && shrunk.minX >= -250 - EPS, 'X must stay within the shrunk blast rect (no aspect padding can push X past it when Y is the padded axis)');
});

test('multiple platforms at different heights: floor spans min/max across all of them', () => {
  const stage = flatStage({
    platforms: [
      { minX: -300, maxX: -100, y: 0 },
      { minX: 100, maxX: 300, y: 150 },
    ],
  });
  const floor = computeFramingFloor(stage, 1280, 720);
  // Before aspect padding, raw minY = 0 - FALL_HEADROOM_WORLD, raw maxY =
  // 150 + JUMP_HEADROOM_WORLD -- padding can only ever grow the box
  // further, never shrink it, so these must still hold as bounds.
  assert.ok(floor.minY <= -FALL_HEADROOM_WORLD + EPS);
  assert.ok(floor.maxY >= 150 + JUMP_HEADROOM_WORLD - EPS);
  assert.ok(floor.minX <= -300 + EPS);
  assert.ok(floor.maxX >= 300 - EPS);
});

test('an already-viewport-matching aspect box is returned essentially unchanged', () => {
  // Construct blast rect and platform so the raw box already matches the
  // viewport aspect ratio (1280x720 => 16:9) -- padding steps should be
  // no-ops (extra ~ 0).
  const viewportAspect = 1280 / 720;
  const spanY = FALL_HEADROOM_WORLD + JUMP_HEADROOM_WORLD; // raw Y span for a y=0 flat platform
  const spanX = spanY * viewportAspect;
  const stage = flatStage({
    platforms: [{ minX: -spanX / 2, maxX: spanX / 2, y: 0 }],
    blastMinX: -spanX, blastMaxX: spanX, blastMinY: -800, blastMaxY: 800,
  });
  const floor = computeFramingFloor(stage, 1280, 720);
  assert.ok(Math.abs(floor.minX - -spanX / 2) < 1e-6);
  assert.ok(Math.abs(floor.maxX - spanX / 2) < 1e-6);
  assert.ok(Math.abs(floor.minY - -FALL_HEADROOM_WORLD) < 1e-6);
  assert.ok(Math.abs(floor.maxY - JUMP_HEADROOM_WORLD) < 1e-6);
});
