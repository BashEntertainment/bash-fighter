// Rasterizes a character's real match silhouette (idle pose, facing right)
// to a small PNG data URL, for the character-select screen. Deliberately
// reuses drawSilhouetteForCharacter -- the exact function FighterSprite
// calls during a live match -- so the select screen can never drift from
// what a fighter actually looks like in play.
import { Application, Graphics } from 'pixi.js';
import { NEUTRAL_POSE } from './fighter-pose.ts';
import { drawSilhouetteForCharacter } from './silhouette-dispatch.ts';

let sharedApp: Application | null = null;

async function getSharedApp(size: number): Promise<Application> {
  if (sharedApp) return sharedApp;
  const app = new Application();
  await app.init({ width: size, height: size, background: 'transparent', antialias: true, preference: 'webgl' });
  sharedApp = app;
  return app;
}

/**
 * Renders one character's idle silhouette into a `size`x`size` transparent
 * PNG data URL, scaled and centred to fit with a small margin. Safe to
 * call for every roster entry up front (e.g. once when the select screen
 * mounts) -- it reuses one small offscreen renderer rather than spinning
 * up a WebGL context per card.
 */
export async function renderCharacterIcon(characterName: string | undefined, tint: number, size = 96): Promise<string> {
  const app = await getSharedApp(size);
  const g = new Graphics();
  drawSilhouetteForCharacter(g, tint, 1, NEUTRAL_POSE, characterName);

  const bounds = g.getLocalBounds();
  const margin = size * 0.12;
  const availableW = size - margin * 2;
  const availableH = size - margin * 2;
  const scale = bounds.width > 0 && bounds.height > 0 ? Math.min(availableW / bounds.width, availableH / bounds.height) : 1;

  g.scale.set(scale);
  // Centre the scaled bounds within the icon square.
  g.position.set(size / 2 - (bounds.x + bounds.width / 2) * scale, size / 2 - (bounds.y + bounds.height / 2) * scale);

  app.stage.removeChildren();
  app.stage.addChild(g);
  app.renderer.render(app.stage);
  const url = await app.renderer.extract.base64(app.stage);
  g.destroy();
  return url;
}
