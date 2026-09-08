// Anchor's silhouette: a hulking, blocky mass with one huge slab-like
// arm -- the largest body of any character, reading as pure crushing
// weight rather than Ballast's smooth riveted ball. Additive, new file,
// same signature as the other fighter-shape-* files.
import { Graphics } from 'pixi.js';
import { PALETTE } from './palette.ts';
import type { Pose } from './fighter-pose.ts';

// Bigger than Ballast's RADIUS=15 circle in every dimension -- the
// largest, heaviest-reading body in the cast.
const HALF_W = 17;
const HEIGHT = 30;

export function drawAnchorSilhouette(g: Graphics, tint: number, facing: 1 | -1, pose: Pose): void {
  // Body: a slab -- flat-topped, flat-bottomed rectangle with only
  // slightly rounded corners -- reads as an immovable block rather than
  // any curved/angular shape used elsewhere.
  const topY = -HEIGHT;
  const botY = 0;
  g.roundRect(-HALF_W, topY, HALF_W * 2, HEIGHT, 4);
  g.fill({ color: tint });
  g.stroke({ color: PALETTE.fighterOutline, width: 3.5 });

  // A dark horizontal band partway down -- reads as a plated seam/belt,
  // reinforcing "armoured mass" texture at a glance.
  g.rect(-HALF_W, topY + HEIGHT * 0.55, HALF_W * 2, HEIGHT * 0.08);
  g.fill({ color: PALETTE.fighterOutline, alpha: 0.5 });

  // One massive slab arm on the facing side -- much thicker than any
  // other character's limb, standing in for a crushing grapple-style
  // hold rather than a strike.
  const restLen = HALF_W * 0.75;
  const len = restLen + pose.limbExtend * HALF_W * 0.9;
  const ang = pose.limbAngle;
  const rootX = facing * HALF_W * 0.95;
  const rootY = topY + HEIGHT * 0.45;
  const tipX = rootX + facing * Math.cos(ang) * len;
  const tipY = rootY + Math.sin(ang) * len * 0.6;
  g.moveTo(rootX, rootY - 6);
  g.lineTo(tipX, tipY - 6);
  g.lineTo(tipX, tipY + 6);
  g.lineTo(rootX, rootY + 6);
  g.closePath();
  g.fill({ color: tint });
  g.stroke({ color: PALETTE.fighterOutline, width: 2.5 });

  // Blunt claw-like tip texture: two short notches, reading as a
  // clamping grip rather than a fist or blade.
  g.rect(tipX - facing * 3, tipY - 6, 2.5, 5);
  g.rect(tipX - facing * 3, tipY + 1, 2.5, 5);
  g.fill({ color: PALETTE.fighterOutline, alpha: 0.6 });
}
