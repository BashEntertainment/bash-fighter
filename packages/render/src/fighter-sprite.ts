// Flat-shape fighter silhouette: a capsule-ish torso plus a head circle,
// with a small nose wedge that shows facing. Deliberately simple so a
// contributor can eventually swap this for real sprites without touching
// the renderer's structure.
import { Graphics } from 'pixi.js';
import { PALETTE } from './palette.ts';
import { drawBallastSilhouette } from './fighter-shape-ballast.ts';
import { drawVoltlingSilhouette } from './fighter-shape-voltling.ts';

export interface FighterVisualState {
  facing: 1 | -1;
  hitstun: number;
  shieldActive: boolean;
  shieldHealthFrac: number; // 0..1
  isDead: boolean;
  /** 0..1, driven by EffectsLayer.flashAmount(fighterIndex) -- how far
   * through the post-hit flash this fighter currently is. 0 = normal
   * colour. Purely presentational; never read by the sim. */
  flashAmount?: number;
  /** CharacterData.name for this fighter, if known. Additive: selects an
   * alternate silhouette (see fighter-shape-ballast.ts) for characters
   * other than the placeholder capsule. Undefined/unknown falls back to
   * the default capsule-plus-head shape below. */
  characterName?: string;
}

// World units, not pixels — the root container is scaled by the camera's
// pixels-per-unit factor, same as everything else drawn in the arena.
// Sized to read clearly against a stage a few hundred units wide rather
// than to match the sim's (much smaller) hurtbox exactly; the debug
// overlay is what shows the real hurtbox.
const BODY_WIDTH = 14;
const BODY_HEIGHT = 26;
const HEAD_RADIUS = 6;

function lerpColor(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 0xff, ag = (a >> 8) & 0xff, ab = a & 0xff;
  const br = (b >> 16) & 0xff, bg = (b >> 8) & 0xff, bb = b & 0xff;
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return (r << 16) | (g << 8) | bl;
}

export class FighterSprite {
  readonly root = new Graphics();
  private readonly bodyColor: number;

  constructor(playerIndex: number) {
    this.bodyColor = PALETTE.fighters[playerIndex % PALETTE.fighters.length] as number;
  }

  draw(state: FighterVisualState): void {
    const g = this.root;
    g.clear();
    if (state.isDead) return;

    // Base tint: danger-red while in hitstun (existing behaviour), else
    // the fighter's own colour blended toward a bright flash colour for
    // the brief post-hit window -- the flash reads as "impact" even after
    // hitstun itself has ended (hitstun on a light jab can be very short).
    const flash = state.flashAmount ?? 0;
    const baseTint = state.hitstun > 0 ? PALETTE.danger : this.bodyColor;
    const tint = flash > 0 ? lerpColor(baseTint, PALETTE.hud, flash * 0.85) : baseTint;

    if (state.characterName === 'Ballast') {
      drawBallastSilhouette(g, tint, state.facing);
      if (state.shieldActive) this.drawShieldBubble(state);
      return;
    }

    if (state.characterName === 'Voltling') {
      drawVoltlingSilhouette(g, tint, state.facing);
      if (state.shieldActive) this.drawShieldBubble(state);
      return;
    }

    // Torso (capsule): rounded rect centered on origin, feet at y=0 going up.
    g.roundRect(-BODY_WIDTH / 2, -BODY_HEIGHT, BODY_WIDTH, BODY_HEIGHT - HEAD_RADIUS * 0.6, 10);
    g.fill({ color: tint });
    g.stroke({ color: PALETTE.fighterOutline, width: 2 });

    // Head.
    const headCy = -BODY_HEIGHT + HEAD_RADIUS * 0.4;
    g.circle(0, headCy, HEAD_RADIUS);
    g.fill({ color: tint });
    g.stroke({ color: PALETTE.fighterOutline, width: 2 });

    // Facing nose: small wedge off the head, on the facing side.
    const nx = state.facing * HEAD_RADIUS * 1.5;
    g.poly([
      state.facing * HEAD_RADIUS * 0.6, headCy - 4,
      nx, headCy,
      state.facing * HEAD_RADIUS * 0.6, headCy + 4,
    ]);
    g.fill({ color: PALETTE.fighterOutline });

    // Shield bubble.
    if (state.shieldActive) this.drawShieldBubble(state);
  }

  private drawShieldBubble(state: FighterVisualState): void {
    const r = BODY_WIDTH * 0.95;
    this.root.circle(0, -BODY_HEIGHT / 2, r);
    this.root.stroke({ color: PALETTE.hud, width: 2, alpha: 0.5 + 0.5 * state.shieldHealthFrac });
    this.root.fill({ color: PALETTE.hud, alpha: 0.08 + 0.1 * state.shieldHealthFrac });
  }
}
