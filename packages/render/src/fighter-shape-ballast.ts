// Ballast's silhouette: a heavy round riveted weight instead of the
// placeholder's capsule-plus-head. Additive, new file -- see the file
// ownership note in fighter-sprite.ts. Kept as a plain drawing function
// (no class/state of its own) so FighterSprite can call it inline for a
// fighter whose CharacterData.name is 'Ballast', without this file ever
// needing to import or duplicate FighterSprite's flash/tint logic.
import { Graphics } from 'pixi.js';
import { PALETTE } from './palette.ts';

// Bigger and rounder than the placeholder's BODY_WIDTH=14/BODY_HEIGHT=26 --
// a heavier fighter should read as physically larger at a glance.
const RADIUS = 15;
const CENTER_Y = -RADIUS - 2; // feet at y=0, same convention as FighterSprite

export function drawBallastSilhouette(g: Graphics, tint: number, facing: 1 | -1): void {
  // Body: one big circle -- the "weight" -- rather than torso+head.
  g.circle(0, CENTER_Y, RADIUS);
  g.fill({ color: tint });
  g.stroke({ color: PALETTE.fighterOutline, width: 3 });

  // Two rivet dots near the top, purely decorative texture that reads as
  // "riveted iron" and helps distinguish the silhouette from a plain ball.
  g.circle(-RADIUS * 0.35, CENTER_Y - RADIUS * 0.55, 1.6);
  g.circle(RADIUS * 0.35, CENTER_Y - RADIUS * 0.55, 1.6);
  g.fill({ color: PALETTE.fighterOutline, alpha: 0.6 });

  // Single stubby limb on the facing side, standing in for a head/nose --
  // shows facing without adding a second body mass like the placeholder's
  // head circle.
  const limbX = facing * RADIUS * 0.9;
  g.roundRect(
    facing === 1 ? limbX : limbX - RADIUS * 0.55,
    CENTER_Y - 3,
    RADIUS * 0.55,
    6,
    3,
  );
  g.fill({ color: tint });
  g.stroke({ color: PALETTE.fighterOutline, width: 2 });
}
