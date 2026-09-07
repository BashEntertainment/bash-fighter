// Flat-shape fighter silhouette: a capsule-ish torso plus a head circle,
// with a small nose wedge that shows facing. Deliberately simple so a
// contributor can eventually swap this for real sprites without touching
// the renderer's structure.
import { Graphics } from 'pixi.js';
import { PALETTE } from './palette.ts';

export interface FighterVisualState {
  facing: 1 | -1;
  hitstun: number;
  shieldActive: boolean;
  shieldHealthFrac: number; // 0..1
  isDead: boolean;
}

const BODY_WIDTH = 34;
const BODY_HEIGHT = 62;
const HEAD_RADIUS = 14;

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

    const tint = state.hitstun > 0 ? PALETTE.danger : this.bodyColor;

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
    if (state.shieldActive) {
      const r = BODY_WIDTH * 0.95;
      g.circle(0, -BODY_HEIGHT / 2, r);
      g.stroke({ color: PALETTE.hud, width: 2, alpha: 0.5 + 0.5 * state.shieldHealthFrac });
      g.fill({ color: PALETTE.hud, alpha: 0.08 + 0.1 * state.shieldHealthFrac });
    }
  }
}
