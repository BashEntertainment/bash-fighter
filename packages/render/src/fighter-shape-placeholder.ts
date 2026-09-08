// Placeholder's silhouette: the original capsule-plus-head shape, kept as
// the fallback for any character without its own drawFooSilhouette entry.
// Pulled out of fighter-sprite.ts into its own file, matching every other
// fighter-shape-* file, so silhouette-dispatch.ts can share it with
// FighterSprite without those two files importing each other.
import { Graphics } from 'pixi.js';
import { PALETTE } from './palette.ts';
import type { Pose } from './fighter-pose.ts';

// World units, not pixels -- also re-exported for anything (e.g. the
// local-player marker) that needs to know the baseline body size.
export const BODY_WIDTH = 14;
export const BODY_HEIGHT = 26;
export const HEAD_RADIUS = 6;

export function drawPlaceholderSilhouette(g: Graphics, tint: number, facing: 1 | -1, pose: Pose): void {
  // Torso (capsule): rounded rect centered on origin, feet at y=0 going up.
  g.roundRect(-BODY_WIDTH / 2, -BODY_HEIGHT, BODY_WIDTH, BODY_HEIGHT - HEAD_RADIUS * 0.6, 10);
  g.fill({ color: tint });
  g.stroke({ color: PALETTE.fighterOutline, width: 2 });

  // Head.
  const headCy = -BODY_HEIGHT + HEAD_RADIUS * 0.4;
  g.circle(0, headCy, HEAD_RADIUS);
  g.fill({ color: tint });
  g.stroke({ color: PALETTE.fighterOutline, width: 2 });

  // Facing limb: a wedge off the head that swings with the pose's
  // limbAngle/limbExtend instead of always sitting as a static "nose".
  // At rest (limbExtend=0) it collapses back to the original nose wedge.
  const restLen = HEAD_RADIUS * 1.5;
  const len = restLen + pose.limbExtend * HEAD_RADIUS * 2.5;
  const ang = pose.limbAngle;
  const baseX = facing * HEAD_RADIUS * 0.6;
  const tipX = baseX + facing * Math.cos(ang) * len;
  const tipY = headCy + Math.sin(ang) * len * 0.6;
  g.poly([baseX, headCy - 4, tipX, tipY, baseX, headCy + 4]);
  g.fill({ color: PALETTE.fighterOutline });
}
