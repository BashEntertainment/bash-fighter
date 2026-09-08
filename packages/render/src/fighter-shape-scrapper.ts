// Scrapper's silhouette: a low, wide, stocky brawler -- squat shoulders
// and a wide stance instead of the placeholder's tall capsule, Ballast's
// round weight, Voltling's diamond, or Reed's tall stalk. Additive, new
// file, same drawing-function signature as the other fighter-shape-*
// files so FighterSprite can call it inline for CharacterData.name ===
// 'Scrapper'.
import { Graphics } from 'pixi.js';
import { PALETTE } from './palette.ts';
import type { Pose } from './fighter-pose.ts';

// Wider and shorter than the placeholder's BODY_WIDTH=14/BODY_HEIGHT=26 --
// a low centre of gravity that reads as "always closing distance". Pushed
// wider and flatter still (was 18x22) so the bounding box itself reads as
// a squashed-wide slab, clear of Zephyr's smaller rounded squat shape and
// Ballast's round one -- Scrapper is the only silhouette in the cast
// distinctly wider than it is tall by this much.
const HALF_W = 13;
const HEIGHT = 15;

export function drawScrapperSilhouette(g: Graphics, tint: number, facing: 1 | -1, pose: Pose): void {
  // Body: a wide flat-topped trapezoid -- broad shoulders tapering to a
  // narrower stance, the opposite proportions of every existing shape.
  const topY = -HEIGHT;
  const botY = 0;
  g.poly([-HALF_W * 0.65, topY, HALF_W * 0.65, topY, HALF_W, botY, -HALF_W, botY]);
  g.fill({ color: tint });
  g.stroke({ color: PALETTE.fighterOutline, width: 2.5 });

  // Small compact head, tucked low into the shoulders (no visible neck) --
  // reinforces the squat, guarded brawler stance.
  g.circle(0, topY - 3, 4);
  g.fill({ color: tint });
  g.stroke({ color: PALETTE.fighterOutline, width: 2 });

  // Short, blunt forward fist on the facing side -- the shortest limb
  // reach of any character, matching its shortest-range moveset.
  const restLen = HALF_W * 0.5;
  const len = restLen + pose.limbExtend * HALF_W * 0.6;
  const ang = pose.limbAngle;
  const rootX = facing * HALF_W * 0.8;
  const rootY = topY + HEIGHT * 0.55;
  const tipX = rootX + facing * Math.cos(ang) * len;
  const tipY = rootY + Math.sin(ang) * len * 0.6;
  g.moveTo(rootX, rootY - 2.5);
  g.lineTo(tipX, tipY - 2.5);
  g.lineTo(tipX, tipY + 2.5);
  g.lineTo(rootX, rootY + 2.5);
  g.closePath();
  g.fill({ color: tint });
  g.stroke({ color: PALETTE.fighterOutline, width: 2 });
  // Fist knuckle -- a small square cap reinforcing "brawler fist" over
  // "limb/nose", distinct from every other character's limb tip shape.
  g.rect(tipX - facing * 2 - 2, tipY - 2, 4, 4);
  g.fill({ color: PALETTE.fighterOutline, alpha: 0.5 });
}
