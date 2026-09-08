// Reed's silhouette: a tall, slim reed/stalk body with one long jointed
// limb, distinct from the placeholder's capsule+head, Ballast's round
// riveted weight, and Voltling's small angular diamond. Additive, new
// file -- same pattern/signature as the other drawFooSilhouette
// functions so FighterSprite can call it inline for a fighter whose
// CharacterData.name is 'Reed'.
import { Graphics } from 'pixi.js';
import { PALETTE } from './palette.ts';
import type { Pose } from './fighter-pose.ts';

// Narrower than every existing silhouette (HALF_W below placeholder's
// BODY_WIDTH/2=7 and Voltling's HALF_W=6) but taller than all of them
// (HEIGHT above placeholder's BODY_HEIGHT=26 and Ballast's RADIUS*2=30)
// -- reads as a slim upright stalk, matching the data's narrow-but-tall
// hurtbox (width 10 / height 36).
const HALF_W = 4;
const HEIGHT = 30;

export function drawReedSilhouette(g: Graphics, tint: number, facing: 1 | -1, pose: Pose): void {
  // Body: a long thin tapered stalk (narrow hexagon) instead of a
  // capsule, circle, or diamond -- the tallest, thinnest shape in the
  // roster, unmistakable at FFA distance even before colour is read.
  const topY = -HEIGHT;
  const botY = 0;
  const waistY = -HEIGHT * 0.4;
  g.poly([
    0, topY,
    HALF_W, topY + HEIGHT * 0.18,
    HALF_W * 0.7, waistY,
    HALF_W, botY,
    -HALF_W, botY,
    -HALF_W * 0.7, waistY,
    -HALF_W, topY + HEIGHT * 0.18,
  ]);
  g.fill({ color: tint });
  g.stroke({ color: PALETTE.fighterOutline, width: 2 });

  // A slim bud/node near the top standing in for a head, kept small so
  // the overall silhouette stays a single tapering line.
  g.circle(0, topY - HALF_W * 0.6, HALF_W * 0.75);
  g.fill({ color: PALETTE.hud, alpha: 0.85 });
  g.stroke({ color: PALETTE.fighterOutline, width: 1.5 });

  // One long jointed limb on the facing side -- reaches much farther
  // from the body than any other character's limb, visually promising
  // the long disjointed reach the moveset actually has.
  const rootX = facing * HALF_W * 0.8;
  const rootY = waistY;
  const reach = HALF_W * (5 + pose.limbExtend * 3.5);
  const kinkX = rootX + facing * Math.cos(pose.limbAngle) * reach * 0.55;
  const kinkY = rootY + Math.sin(pose.limbAngle) * reach * 0.2;
  const tipX = rootX + facing * Math.cos(pose.limbAngle) * reach;
  const tipY = rootY + Math.sin(pose.limbAngle) * reach * 0.35;
  g.moveTo(rootX, rootY - 1.5);
  g.lineTo(kinkX, kinkY - 1.5);
  g.lineTo(tipX, tipY);
  g.lineTo(kinkX, kinkY + 1.5);
  g.lineTo(rootX, rootY + 1.5);
  g.closePath();
  g.fill({ color: tint });
  g.stroke({ color: PALETTE.fighterOutline, width: 1.5 });
}
