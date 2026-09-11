// Wisp's silhouette: a small floating orb -- round on every side, no
// taper, no point -- rather than the thin vertical sliver this used to
// be. Additive, new file, same signature as the other fighter-shape-*
// files.
//
// 2026-09-11 silhouette-differentiation pass: at true 20-fighter zoom in
// grayscale, the old lens shape (a tall pointed sliver, HALF_W=4,
// HEIGHT=18) and Reed's tall tapered stalk (HALF_W=4, HEIGHT=34) both
// collapsed into the same family -- "thin vertical shape with a pointed
// top and a small round node" -- and were confirmed confusable live (see
// "Local Crowd Testing Tool 2026-09-11", fighters #5/#20 in a real
// crowd). Height alone (18 vs 34) is not a strong enough cue once a
// fighter is 10-15px tall on screen and partly occluded.
//
// Fix: change Wisp's shape *family*, not just its size. Wisp is now
// round where Reed is a straight taper, and wide-relative-to-height
// (HALF_W=7, HEIGHT=11 -- roughly the aspect ratio of Ballast's circle,
// just much smaller) where Reed is the narrowest, tallest shape in the
// cast. The float gap is kept (unique to Wisp) as a second, independent
// cue. This also keeps Wisp clear of Zephyr's teardrop-plus-fin: a
// symmetric round orb with no fin reads differently from a leaning
// asymmetric teardrop even with all colour and the fin's curve detail
// gone.
import { Graphics } from 'pixi.js';
import { PALETTE } from './palette.ts';
import type { Pose } from './fighter-pose.ts';

const HALF_W = 7;
const HEIGHT = 11;
const FLOAT_GAP = 6;

export function drawWispSilhouette(g: Graphics, tint: number, facing: 1 | -1, pose: Pose): void {
  // Body: a simple rounded orb (ellipse), the only fully round-on-every-
  // side body in the cast besides Ballast's much bigger circle -- no
  // taper, no point, so it can't be mistaken for Reed's stalk, Voltling's
  // diamond, or Zephyr's teardrop even as a flat grey blob.
  const topY = -HEIGHT - FLOAT_GAP;
  const midY = topY + HEIGHT / 2;
  g.ellipse(0, midY, HALF_W, HEIGHT / 2);
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
