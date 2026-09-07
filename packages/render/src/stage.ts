// Draws the stage platform and blast-zone boundary from arena data —
// dimensions always come from StageBounds, never a hardcoded size, so
// this reads correctly whether it's today's single platform or a future
// multi-platform 20-player arena. Blast zones are drawn as an obvious
// dashed line + darker outer wash so a player always knows how far
// offstage is safe.
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

// How thick the platform slab reads, in world units — scales with the
// camera like everything else, so it stays proportionally chunky whether
// we're zoomed into a 400-unit stage or a much bigger one later.
const PLATFORM_DEPTH_WORLD = 22;

export function drawStage(
  g: Graphics,
  bounds: StageBounds,
  cam: CameraView,
  viewWidth: number,
  viewHeight: number,
): void {
  g.clear();

  // Darker wash outside the blast zone so "offstage" reads as a distinct
  // zone even before the dashed line registers.
  const outerTL = worldToScreen(bounds.blastMinX - 400, bounds.blastMaxY + 400, cam, viewWidth, viewHeight);
  const outerBR = worldToScreen(bounds.blastMaxX + 400, bounds.blastMinY - 400, cam, viewWidth, viewHeight);
  g.rect(outerTL.x, outerTL.y, outerBR.x - outerTL.x, outerBR.y - outerTL.y);
  g.fill({ color: PALETTE.background });

  const insideTL = worldToScreen(bounds.blastMinX, bounds.blastMaxY, cam, viewWidth, viewHeight);
  const insideBR = worldToScreen(bounds.blastMaxX, bounds.blastMinY, cam, viewWidth, viewHeight);
  g.rect(insideTL.x, insideTL.y, insideBR.x - insideTL.x, insideBR.y - insideTL.y);
  g.fill({ color: PALETTE.blastZone, alpha: 0.35 });

  // Solid platform slab, drawn with a visible top edge and a darker
  // underside so it reads as a floating platform, not a flat line.
  const topL = worldToScreen(bounds.stageMinX, bounds.groundY, cam, viewWidth, viewHeight);
  const topR = worldToScreen(bounds.stageMaxX, bounds.groundY, cam, viewWidth, viewHeight);
  const depthPx = PLATFORM_DEPTH_WORLD * cam.scale;
  const width = topR.x - topL.x;

  g.rect(topL.x, topL.y, width, depthPx);
  g.fill({ color: PALETTE.stageFill });
  g.rect(topL.x, topL.y + depthPx * 0.55, width, depthPx * 0.45);
  g.fill({ color: PALETTE.background, alpha: 0.35 });
  g.rect(topL.x, topL.y, width, Math.max(3, depthPx * 0.08));
  g.fill({ color: PALETTE.stageEdge });

  // Blast zone boundary: dashed rectangle around the whole arena.
  drawDashedRect(g, insideTL.x, insideTL.y, insideBR.x - insideTL.x, insideBR.y - insideTL.y, PALETTE.danger);
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
