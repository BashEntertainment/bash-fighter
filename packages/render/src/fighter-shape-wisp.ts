// Wisp's silhouette: a thin, wavering, ghost-like sliver body with a
// long thread-like limb -- the narrowest body in the cast, reading as
// something that drifts rather than stands. Additive, new file, same
// signature as the other fighter-shape-* files.
import { Graphics } from 'pixi.js';
import { PALETTE } from './palette.ts';
import type { Pose } from './fighter-pose.ts';

// Narrower than every other character (matches its 11x30 hurtbox) but
// not as tall as Reed -- a small, slight, drifting shape.
const HALF_W = 4.5;
const HEIGHT = 24;

export function drawWispSilhouette(g: Graphics, tint: number, facing: 1 | -1, pose: Pose): void {
  // Body: a wavering vertical sliver -- a soft lens shape rather than
  // any straight-sided silhouette used elsewhere, with a lower alpha
  // stroke so it reads as light/insubstantial next to the cast's solid
  // bodies.
  const topY = -HEIGHT;
  const botY = 0;
  const midY = -HEIGHT * 0.5;
  g.poly([0, topY, HALF_W, midY, HALF_W * 0.55, botY, -HALF_W * 0.55, botY, -HALF_W, midY]);
  g.fill({ color: tint, alpha: 0.92 });
  g.stroke({ color: PALETTE.fighterOutline, width: 1.5 });

  // Faint trailing wisp streaks behind the body -- small translucent
  // slivers, purely decorative texture that reinforces "drifting" and
  // is unique to this character.
  g.circle(-facing * HALF_W * 1.3, midY + 2, 1.8);
  g.circle(-facing * HALF_W * 2.0, midY + 6, 1.2);
  g.fill({ color: tint, alpha: 0.35 });

  // Bright core near the top, smaller than any other character's --
  // an ember rather than a face.
  g.circle(0, topY + 3, 2.2);
  g.fill({ color: PALETTE.hud, alpha: 0.9 });

  // Long thin thread-like limb -- the longest, thinnest limb in the
  // cast, matching its longest-reach moveset.
  const restLen = HALF_W * 3.2;
  const len = restLen + pose.limbExtend * HALF_W * 3.5;
  const ang = pose.limbAngle;
  const rootX = facing * HALF_W * 0.9;
  const rootY = midY;
  const tipX = rootX + facing * Math.cos(ang) * len;
  const tipY = rootY + Math.sin(ang) * len * 0.35;
  g.moveTo(rootX, rootY - 1);
  g.lineTo(tipX, tipY - 1);
  g.lineTo(tipX, tipY + 1);
  g.lineTo(rootX, rootY + 1);
  g.closePath();
  g.fill({ color: tint });
  g.stroke({ color: PALETTE.fighterOutline, width: 1 });
  // A tiny bright spark at the very tip -- reads as the strike point of
  // a long-reaching poke.
  g.circle(tipX, tipY, 1.6);
  g.fill({ color: PALETTE.hud, alpha: 0.85 });
}
