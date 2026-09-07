// Draws the stage platform and blast-zone boundary. Blast zones are drawn
// as an obvious dashed line + darker outer fill so a player always knows
// how far offstage is safe.
import { Graphics } from 'pixi.js';
import { PALETTE } from './palette.ts';
import type { CameraView } from './camera.ts';
import { worldToScreen } from './camera.ts';

export interface StageBounds {
  stageMinX: number;
  stageMaxX: number;
  groundY: number;
  blastMinX: number;
  blastMaxX: number;
  blastMinY: number;
  blastMaxY: number;
}

export function drawStage(
  g: Graphics,
  bounds: StageBounds,
  cam: CameraView,
  viewWidth: number,
  viewHeight: number,
): void {
  g.clear();

  const platformTopL = worldToScreen(bounds.stageMinX, bounds.groundY, cam, viewWidth, viewHeight);
  const platformTopR = worldToScreen(bounds.stageMaxX, bounds.groundY, cam, viewWidth, viewHeight);
  const platformDepth = 26 * cam.scale > 40 ? 40 : Math.max(18, 26 * cam.scale);

  // Solid platform slab.
  g.rect(platformTopL.x, platformTopL.y, platformTopR.x - platformTopL.x, platformDepth);
  g.fill({ color: PALETTE.stageFill });
  g.rect(platformTopL.x, platformTopL.y, platformTopR.x - platformTopL.x, 3);
  g.fill({ color: PALETTE.stageEdge });

  // Blast zone boundary: dashed rectangle well outside the platform.
  const bl = worldToScreen(bounds.blastMinX, bounds.blastMaxY, cam, viewWidth, viewHeight);
  const br = worldToScreen(bounds.blastMaxX, bounds.blastMinY, cam, viewWidth, viewHeight);
  drawDashedRect(g, bl.x, bl.y, br.x - bl.x, br.y - bl.y, PALETTE.danger);
}

function drawDashedRect(g: Graphics, x: number, y: number, w: number, h: number, color: number): void {
  const dash = 10;
  const gap = 8;
  const segments: [number, number, number, number][] = [
    [x, y, x + w, y],
    [x + w, y, x + w, y + h],
    [x + w, y + h, x, y + h],
    [x, y + h, x, y],
  ];
  for (const [x0, y0, x1, y1] of segments) {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len = Math.hypot(dx, dy);
    const steps = Math.max(1, Math.floor(len / (dash + gap)));
    for (let i = 0; i < steps; i++) {
      const t0 = (i * (dash + gap)) / len;
      const t1 = Math.min(1, t0 + dash / len);
      g.moveTo(x0 + dx * t0, y0 + dy * t0);
      g.lineTo(x0 + dx * t1, y0 + dy * t1);
    }
  }
  g.stroke({ color, width: 2, alpha: 0.8 });
}
