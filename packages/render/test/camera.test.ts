// Unit tests for packages/render/src/camera.ts's computeCamera aspect-ratio
// framing math (issue #18). Pure math over plain numbers, no Pixi/DOM --
// matches the node:test + node:assert style of palette.test.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeCamera, type ArenaBounds, type CameraConfig } from '../src/camera.ts';

const EPS = 1e-6;

function cfg(overrides: Partial<CameraConfig> = {}): CameraConfig {
  return {
    viewWidth: 1280,
    viewHeight: 720,
    minScale: 1,
    maxScale: 50,
    paddingWorld: 20,
    arena: { minX: -200, maxX: 200, minY: 0, maxY: 200 },
    ...overrides,
  };
}

function aspectRatioOfSpan(c: CameraConfig, cam: { scale: number }): number {
  // The frame's world-space span on each axis is view / scale; its ratio
  // should match the viewport's own aspect ratio within epsilon.
  const spanX = c.viewWidth / cam.scale;
  const spanY = c.viewHeight / cam.scale;
  return spanX / spanY;
}

test('wide-flat arena (the-undercroft-like): frame aspect ratio matches the viewport', () => {
  const c = cfg({ arena: { minX: -600, maxX: 600, minY: 0, maxY: 150 } });
  const cam = computeCamera([{ x: 0, y: 50 }], c);
  const viewportAR = c.viewWidth / c.viewHeight;
  const frameAR = aspectRatioOfSpan(c, cam);
  assert.ok(Math.abs(frameAR - viewportAR) < 1e-3, `frameAR=${frameAR} viewportAR=${viewportAR}`);
});

test('tall-narrow arena (the-spire-like): frame aspect ratio matches the viewport', () => {
  const c = cfg({ arena: { minX: -80, maxX: 80, minY: 0, maxY: 900 } });
  const cam = computeCamera([{ x: 0, y: 400 }], c);
  const viewportAR = c.viewWidth / c.viewHeight;
  const frameAR = aspectRatioOfSpan(c, cam);
  assert.ok(Math.abs(frameAR - viewportAR) < 1e-3, `frameAR=${frameAR} viewportAR=${viewportAR}`);
});

test('near-square arena: frame aspect ratio still matches the viewport', () => {
  const c = cfg({ arena: { minX: -150, maxX: 150, minY: 0, maxY: 300 }, viewWidth: 800, viewHeight: 800 });
  const cam = computeCamera([{ x: 10, y: 120 }, { x: -30, y: 200 }], c);
  const frameAR = aspectRatioOfSpan(c, cam);
  assert.ok(Math.abs(frameAR - 1) < 1e-3, `frameAR=${frameAR}`);
});

test('a couple of fighters standing close together never zooms tighter than the arena floor', () => {
  const c = cfg();
  const cam = computeCamera(
    [{ x: 0, y: 50 }, { x: 5, y: 50 }],
    c,
  );
  const arenaSpanX = c.arena.maxX - c.arena.minX;
  const arenaSpanY = c.arena.maxY - c.arena.minY;
  const arenaFitScale = Math.min(c.viewWidth / arenaSpanX, c.viewHeight / arenaSpanY);
  // scale should not exceed what's needed to fit the whole arena -- i.e.
  // the view is at least as wide (in world units) as the arena itself.
  assert.ok(cam.scale <= arenaFitScale + EPS, `scale=${cam.scale} arenaFitScale=${arenaFitScale}`);
});

test('fighters spread wider than the arena footprint zoom out to fit them (still clamped by maxScale/minScale)', () => {
  const c = cfg({ arena: { minX: -100, maxX: 100, minY: 0, maxY: 100 } });
  const tight = computeCamera([{ x: 0, y: 50 }], c);
  const spread = computeCamera([{ x: -500, y: 50 }, { x: 500, y: 50 }], c);
  assert.ok(spread.scale < tight.scale, 'spreading fighters apart should zoom out (lower scale)');
});

test('scale is clamped between minScale and maxScale', () => {
  const c = cfg({ minScale: 2, maxScale: 3, arena: { minX: -50, maxX: 50, minY: 0, maxY: 50 } });
  // Single fighter, tiny arena -- would otherwise want to zoom in past maxScale.
  const cam = computeCamera([{ x: 0, y: 25 }], c);
  assert.ok(cam.scale <= c.maxScale + EPS);
  assert.ok(cam.scale >= Math.min(c.minScale, c.viewWidth / 100, c.viewHeight / 100) - EPS);
});

test('clamped correctly once the live blast rect (arena) is smaller than the natural floor: frame never exceeds the arena footprint scale', () => {
  // Simulates a collapsing arena: the live blast rect shrinks well below
  // any reasonable "natural minimum" footprint. The camera must still
  // frame at most the arena's own span (not zoom in tighter than what
  // the shrunk arena's fit-scale allows), i.e. respect the live bounds.
  const shrunkArena: ArenaBounds = { minX: -20, maxX: 20, minY: 0, maxY: 20 };
  const c = cfg({ arena: shrunkArena, minScale: 1, maxScale: 100 });
  const cam = computeCamera([{ x: 0, y: 10 }], c);
  const arenaFitScale = Math.min(c.viewWidth / 40, c.viewHeight / 20);
  assert.ok(cam.scale <= arenaFitScale + EPS, `scale=${cam.scale} should not exceed arena fit scale=${arenaFitScale}`);
});

test('empty fighter list falls back to framing the whole arena', () => {
  const c = cfg({ arena: { minX: -300, maxX: 300, minY: 0, maxY: 150 } });
  const cam = computeCamera([], c);
  assert.equal(cam.centerX, 0);
  assert.equal(cam.centerY, 75);
  const viewportAR = c.viewWidth / c.viewHeight;
  const frameAR = aspectRatioOfSpan(c, cam);
  assert.ok(Math.abs(frameAR - viewportAR) < 1e-3);
});

test('center clamps to stay within arena bounds when a fighter sits near the edge', () => {
  const c = cfg({ arena: { minX: -1000, maxX: 1000, minY: 0, maxY: 400 }, minScale: 5, maxScale: 5 });
  // Force scale=5 via min=max, fighter far to one side.
  const cam = computeCamera([{ x: 950, y: 50 }], c);
  const halfViewWorldX = c.viewWidth / 2 / cam.scale;
  assert.ok(cam.centerX <= c.arena.maxX - halfViewWorldX + EPS);
  assert.ok(cam.centerX >= c.arena.minX + halfViewWorldX - EPS);
});
