// Voltling's silhouette: a small angular diamond body with a jagged
// lightning-bolt limb, instead of the placeholder's capsule-plus-head or
// Ballast's big rounded weight. Additive, new file -- see the file
// ownership note in fighter-sprite.ts. A plain drawing function, same
// pattern/signature as drawBallastSilhouette, so FighterSprite can call
// it inline for a fighter whose CharacterData.name is 'Voltling'.
import { Graphics } from 'pixi.js';
import { PALETTE } from './palette.ts';
import type { Pose } from './fighter-pose.ts';

// Smaller and narrower than the placeholder's BODY_WIDTH=14/BODY_HEIGHT=26
// and much smaller than Ballast's RADIUS=15 circle -- a light, fast
// fighter should read as physically small at a glance. Pulled in further
// (was 12x20) so the overall bounding box is unambiguously the smallest
// pointed shape in the cast, clear of Zephyr's squat-but-wider silhouette
// even with all colour and internal detail removed.
const HALF_W = 6;
const HEIGHT = 15;

// 2026-09-09 spike pass: with colour stripped, Voltling's smooth convex
// diamond read too close to Wisp's smooth convex lens. Fixed by making
// the body itself jagged -- concave notches down each side -- instead of
// a plain diamond, so Voltling reads as a spiky bolt and Wisp stays a
// smooth floating lens; the two shape families no longer overlap.
export function drawVoltlingSilhouette(g: Graphics, tint: number, facing: 1 | -1, pose: Pose): void {
  const topY = -HEIGHT;
  const botY = 0;
  const midY = topY + HEIGHT * 0.55;
  g.poly([
    0, topY,
    HALF_W * 0.55, topY + HEIGHT * 0.22,
    HALF_W * 0.2, topY + HEIGHT * 0.3,
    HALF_W, topY + HEIGHT * 0.55,
    HALF_W * 0.25, topY + HEIGHT * 0.66,
    HALF_W * 0.6, botY,
    0, topY + HEIGHT * 0.8,
    -HALF_W * 0.6, botY,
    -HALF_W * 0.25, topY + HEIGHT * 0.66,
    -HALF_W, topY + HEIGHT * 0.55,
    -HALF_W * 0.2, topY + HEIGHT * 0.3,
    -HALF_W * 0.55, topY + HEIGHT * 0.22,
  ]);
  g.fill({ color: tint });
  g.stroke({ color: PALETTE.fighterOutline, width: 2 });

  // Small bright core near the top, standing in for a head -- reads as an
  // energy source rather than a face, keeping the silhouette abstract.
  g.circle(0, topY + HALF_W * 0.9, HALF_W * 0.55);
  g.fill({ color: PALETTE.hud, alpha: 0.9 });
  g.stroke({ color: PALETTE.fighterOutline, width: 1.5 });

  // Jagged lightning-bolt limb on the facing side, standing in for a nose
  // -- drawn as a zig-zag rather than a smooth wedge/stub, so it reads as
  // a distinct texture up close and a distinct silhouette break at a
  // distance from both other characters' limbs.
  const rootX = facing * HALF_W * 0.9;
  const rootY = midY;
  const len = HALF_W * (2.2 + pose.limbExtend * 1.4);
  const swingY = Math.sin(pose.limbAngle) * len * 0.5;
  const tipX = rootX + facing * Math.cos(pose.limbAngle) * len;
  const tipY = rootY + swingY;
  const midX = rootX + facing * Math.cos(pose.limbAngle) * len * 0.5;
  g.moveTo(rootX, rootY - 2);
  g.lineTo(midX, midY - 4);
  g.lineTo(tipX, tipY);
  g.lineTo(midX, midY + 3);
  g.lineTo(rootX, rootY + 2);
  g.closePath();
  g.fill({ color: tint });
  g.stroke({ color: PALETTE.fighterOutline, width: 1.5 });
}
