// Zephyr's silhouette: a small, low, swept-back body with a curved tail
// fin -- reads as coiled/airborne rather than any grounded stance used
// elsewhere. Additive, new file, same signature as the other
// fighter-shape-* files.
import { Graphics } from 'pixi.js';
import { PALETTE } from './palette.ts';
import type { Pose } from './fighter-pose.ts';

// Shorter than every other character (matches its 13x24 hurtbox, the
// shortest in the cast) and narrow -- a compact, crouched shape.
const HALF_W = 6.5;
const HEIGHT = 17;

export function drawZephyrSilhouette(g: Graphics, tint: number, facing: 1 | -1, pose: Pose): void {
  // Body: a rounded teardrop leaning back -- narrower at the top,
  // rounded at the bottom, distinct from Voltling's symmetric diamond
  // and every other shape's straight sides.
  const topY = -HEIGHT;
  const botY = 0;
  g.poly([0, topY, HALF_W * 0.85, topY + HEIGHT * 0.35, HALF_W, botY, -HALF_W * 0.4, botY - 1, -HALF_W * 0.55, topY + HEIGHT * 0.4]);
  g.fill({ color: tint });
  g.stroke({ color: PALETTE.fighterOutline, width: 2 });

  // Small bright core near the top -- distinguishing head marker, kept
  // small to preserve the compact silhouette.
  g.circle(HALF_W * 0.15, topY + 3, 3);
  g.fill({ color: PALETTE.hud, alpha: 0.85 });
  g.stroke({ color: PALETTE.fighterOutline, width: 1.2 });

  // Swept tail fin trailing opposite the facing direction -- a curved
  // fin instead of a limb, reinforcing "always mid-motion" rather than
  // "about to punch". It flicks with limbAngle the same way other
  // characters' limbs swing, just on the trailing side.
  const trail = -facing;
  const len = HALF_W * (1.6 + pose.limbExtend * 1.1);
  const swing = Math.sin(pose.limbAngle) * len * 0.4;
  const rootX = trail * HALF_W * 0.5;
  const rootY = botY - HEIGHT * 0.15;
  const tipX = rootX + trail * Math.cos(pose.limbAngle) * len;
  const tipY = rootY + swing - len * 0.2;
  g.moveTo(rootX, rootY);
  g.quadraticCurveTo(rootX + trail * len * 0.4, rootY - len * 0.1, tipX, tipY);
  g.lineTo(tipX + trail * 2, tipY + 3);
  g.quadraticCurveTo(rootX + trail * len * 0.3, rootY + 4, rootX, rootY + 3);
  g.closePath();
  g.fill({ color: tint, alpha: 0.9 });
  g.stroke({ color: PALETTE.fighterOutline, width: 1.5 });

  // Forward limb: a short quick jab-ready arm on the facing side so
  // attacks still read as coming from the front.
  const flen = HALF_W * (1.0 + pose.limbExtend * 0.8);
  const fx2 = facing * HALF_W * 0.7;
  const ftipX = fx2 + facing * Math.cos(pose.limbAngle) * flen;
  const ftipY = topY + HEIGHT * 0.5 + Math.sin(pose.limbAngle) * flen * 0.5;
  g.moveTo(fx2, topY + HEIGHT * 0.5 - 2);
  g.lineTo(ftipX, ftipY - 2);
  g.lineTo(ftipX, ftipY + 2);
  g.lineTo(fx2, topY + HEIGHT * 0.5 + 2);
  g.closePath();
  g.fill({ color: tint });
  g.stroke({ color: PALETTE.fighterOutline, width: 1.5 });
}
