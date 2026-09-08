// Single source of truth for "which drawFooSilhouette function does this
// character use" -- shared by FighterSprite (live match rendering) and
// renderCharacterIcon (character-select thumbnails), so the select screen
// can never show a different shape than the one a fighter actually wears
// in a match. Adding a character means adding one branch here, once.
import type { Graphics } from 'pixi.js';
import type { Pose } from './fighter-pose.ts';
import { drawBallastSilhouette } from './fighter-shape-ballast.ts';
import { drawVoltlingSilhouette } from './fighter-shape-voltling.ts';
import { drawReedSilhouette } from './fighter-shape-reed.ts';
import { drawScrapperSilhouette } from './fighter-shape-scrapper.ts';
import { drawAnchorSilhouette } from './fighter-shape-anchor.ts';
import { drawZephyrSilhouette } from './fighter-shape-zephyr.ts';
import { drawWispSilhouette } from './fighter-shape-wisp.ts';
import { drawPlaceholderSilhouette } from './fighter-shape-placeholder.ts';

export function drawSilhouetteForCharacter(
  g: Graphics,
  tint: number,
  facing: 1 | -1,
  pose: Pose,
  characterName: string | undefined,
): void {
  if (characterName === 'Ballast') {
    drawBallastSilhouette(g, tint, facing, pose);
  } else if (characterName === 'Voltling') {
    drawVoltlingSilhouette(g, tint, facing, pose);
  } else if (characterName === 'Reed') {
    drawReedSilhouette(g, tint, facing, pose);
  } else if (characterName === 'Scrapper') {
    drawScrapperSilhouette(g, tint, facing, pose);
  } else if (characterName === 'Anchor') {
    drawAnchorSilhouette(g, tint, facing, pose);
  } else if (characterName === 'Zephyr') {
    drawZephyrSilhouette(g, tint, facing, pose);
  } else if (characterName === 'Wisp') {
    drawWispSilhouette(g, tint, facing, pose);
  } else {
    drawPlaceholderSilhouette(g, tint, facing, pose);
  }
}
