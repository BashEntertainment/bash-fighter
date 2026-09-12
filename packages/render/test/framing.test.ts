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

test('dead-space-below-floor fix 2026-09-12: below-ground band is a small minority of the framed box, not ~30%+', () => {
  // Regression pin for the reported defect (wide dark band under the
  // floor eating a fifth-plus of the viewport): for a flat single
  // platform the raw box is exactly FALL_HEADROOM_WORLD below the
  // ground and JUMP_HEADROOM_WORLD above it, so the below-ground share
  // of the *raw* (pre-aspect-padding) vertical span must be small.
  const stage = flatStage();
  const floor = computeFramingFloor(stage, 1280, 720);
  const belowGround = 0 - floor.minY; // ground is at world y=0
  const spanY = floor.maxY - floor.minY;
  assert.ok(belowGround / spanY < 0.27, `below-ground share ${belowGround / spanY} should be under the old ~31%`);
  // And the constants themselves must keep fall < jump, with fall a
  // small minority of their sum -- this is what actually moves the
  // ground down the screen (see framing.ts's headroom comment).
  assert.ok(FALL_HEADROOM_WORLD < JUMP_HEADROOM_WORLD);
  // 2026-09-12, second pass: an earlier attempt pushed this ratio to
  // 40:250 (14%), which put the ground at 90% of viewport height -- the
  // action ended up cramped against the bottom edge under a huge empty
  // sky, worse to look at than the dead band it removed. The band and the
  // sky are counterweights: the honest fix is a moderate shift, not a
  // maximal one. Ground lands near 83% of viewport height at 70:220.
  assert.ok(FALL_HEADROOM_WORLD / (FALL_HEADROOM_WORLD + JUMP_HEADROOM_WORLD) < 0.27);
  assert.ok(FALL_HEADROOM_WORLD / (FALL_HEADROOM_WORLD + JUMP_HEADROOM_WORLD) > 0.18);
});

test('dead-space-below-floor fix 2026-09-12: multi-height stage (battle-royale-20-like) still keeps the below-ground band small', () => {
  // battle-royale-20's real geometry: ground at y=0, platforms up to
  // y=160, spread wide (720 world units) versus a 1280x720 viewport.
  // Reproduces the live-play measurement (~20%+ dead space before this
  // fix) as a permanent regression test.
  const stage: FramingStageBounds = {
    platforms: [
      { minX: -480, maxX: 480, y: 0 },
      { minX: -360, maxX: -220, y: 70 },
      { minX: 220, maxX: 360, y: 70 },
      { minX: -70, maxX: 70, y: 110 },
      { minX: -180, maxX: -100, y: 160 },
      { minX: 100, maxX: 180, y: 160 },
    ],
    blastMinX: -620,
    blastMaxX: 620,
    blastMinY: -260,
    blastMaxY: 520,
  };
  const floor = computeFramingFloor(stage, 1280, 720);
  const belowGround = 0 - floor.minY;
  const spanY = floor.maxY - floor.minY;
  assert.ok(belowGround / spanY < 0.19, `below-ground share ${belowGround / spanY} should be a minority of the frame`);
});

// Population-aware floor shrink (empty-sky pass 2026-09-12).
import {
  populationFloorFrac,
  scaleFramingFloor,
  computePopulationAwareFramingFloor,
  POPULATION_FLOOR_TAPER_START_COUNT,
  POPULATION_FLOOR_MIN_COUNT,
  POPULATION_FLOOR_MIN_FRAC,
} from '../src/framing.ts';

test('populationFloorFrac: no shrink at or above the taper-start count', () => {
  assert.equal(populationFloorFrac(POPULATION_FLOOR_TAPER_START_COUNT), 1);
  assert.equal(populationFloorFrac(POPULATION_FLOOR_TAPER_START_COUNT + 10), 1);
  assert.equal(populationFloorFrac(20), 1);
});

test('populationFloorFrac: held at the minimum fraction at or below the minimum count', () => {
  assert.equal(populationFloorFrac(POPULATION_FLOOR_MIN_COUNT), POPULATION_FLOOR_MIN_FRAC);
  assert.equal(populationFloorFrac(1), POPULATION_FLOOR_MIN_FRAC);
  assert.equal(populationFloorFrac(0), POPULATION_FLOOR_MIN_FRAC);
});

test('populationFloorFrac: linear taper strictly between the two counts, monotonic', () => {
  let prev = populationFloorFrac(POPULATION_FLOOR_MIN_COUNT);
  for (let n = POPULATION_FLOOR_MIN_COUNT + 1; n <= POPULATION_FLOOR_TAPER_START_COUNT; n++) {
    const frac = populationFloorFrac(n);
    assert.ok(frac > prev, `frac(${n})=${frac} should exceed frac(${n - 1})=${prev}`);
    assert.ok(frac <= 1);
    prev = frac;
  }
});

test('scaleFramingFloor: shrinks around the box center, preserving aspect ratio', () => {
  const box = { minX: -100, maxX: 300, minY: -50, maxY: 150 }; // center (100, 50), span 400x200
  const scaled = scaleFramingFloor(box, 0.5);
  assert.equal(scaled.minX, 0);
  assert.equal(scaled.maxX, 200);
  assert.equal(scaled.minY, 0);
  assert.equal(scaled.maxY, 100);
  // Aspect ratio (2:1) unchanged.
  assert.equal((scaled.maxX - scaled.minX) / (scaled.maxY - scaled.minY), (box.maxX - box.minX) / (box.maxY - box.minY));
});

test('scaleFramingFloor: frac=1 is a no-op', () => {
  const box = { minX: -37, maxX: 211, minY: -19, maxY: 88 };
  const scaled = scaleFramingFloor(box, 1);
  assert.equal(scaled.minX, box.minX);
  assert.equal(scaled.maxX, box.maxX);
  assert.equal(scaled.minY, box.minY);
  assert.equal(scaled.maxY, box.maxY);
});

test('computePopulationAwareFramingFloor: full lobby matches the unscaled floor exactly', () => {
  const stage = flatStage();
  const plain = computeFramingFloor(stage, 1280, 720);
  const populationAware = computePopulationAwareFramingFloor(stage, 1280, 720, 20);
  const EPS2 = 1e-9;
  assert.ok(Math.abs(populationAware.minX - plain.minX) < EPS2);
  assert.ok(Math.abs(populationAware.maxX - plain.maxX) < EPS2);
  assert.ok(Math.abs(populationAware.minY - plain.minY) < EPS2);
  assert.ok(Math.abs(populationAware.maxY - plain.maxY) < EPS2);
});

test('computePopulationAwareFramingFloor: shrinks for a late-match 2-fighter endgame, never inverts', () => {
  const stage = flatStage();
  const plain = computeFramingFloor(stage, 1280, 720);
  const endgame = computePopulationAwareFramingFloor(stage, 1280, 720, 2);
  assert.ok(endgame.maxX - endgame.minX < plain.maxX - plain.minX);
  assert.ok(endgame.maxY - endgame.minY < plain.maxY - plain.minY);
  assert.ok(endgame.minX < endgame.maxX);
  assert.ok(endgame.minY < endgame.maxY);
  // Held at the documented floor-on-the-floor fraction.
  const EPS = 1e-9;
  assert.ok(Math.abs((endgame.maxX - endgame.minX) / (plain.maxX - plain.minX) - POPULATION_FLOOR_MIN_FRAC) < EPS);
});
