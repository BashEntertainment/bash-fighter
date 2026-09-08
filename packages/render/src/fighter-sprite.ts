// Flat-shape fighter silhouette, animated by fighter-pose.ts off the
// sim's own state machine. `root` is a thin Container so the pose
// transform (lean/bob/scale) can be applied without touching the
// world-scale set by the caller (camera zoom) -- the caller still does
// `sprite.root.position.set(...)` and `sprite.root.scale.set(cam.scale)`
// exactly as before; everything pose-driven lives on the `body` child.
import { Container, Graphics } from 'pixi.js';
import { PALETTE } from './palette.ts';
import { drawBallastSilhouette } from './fighter-shape-ballast.ts';
import { drawVoltlingSilhouette } from './fighter-shape-voltling.ts';
import { computePose, NEUTRAL_POSE, type Pose, type PoseInput } from './fighter-pose.ts';
import type { AnimationParams } from '@bash-fighter/content';
import type { CharacterData, FighterStateValue } from '@bash-fighter/sim';

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
  /** State machine + animation inputs, all optional so existing callers
   * (and tests) that only care about tint/shield keep working: without
   * these the sprite falls back to a static NEUTRAL_POSE, same as
   * before this file grew an animation system. */
  state?: FighterStateValue;
  stateTicks?: number;
  moveId?: number;
  moveFrame?: number;
  character?: CharacterData;
  anim?: AnimationParams;
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
  readonly root = new Container();
  private readonly body = new Graphics();
  private readonly shieldGfx = new Graphics();
  private readonly bodyColor: number;

  // Render-side-only bookkeeping for animation phase: which sim state we
  // were in last draw() and how many consecutive draws we've been in it.
  // This never feeds back into the sim; it just lets idle/run/attack
  // cycles restart cleanly whenever the fighter's state changes.
  private lastState: FighterStateValue | undefined;
  private stateTicks = 0;

  constructor(playerIndex: number) {
    this.bodyColor = PALETTE.fighters[playerIndex % PALETTE.fighters.length] as number;
    this.root.addChild(this.body);
    this.root.addChild(this.shieldGfx);
  }

  draw(state: FighterVisualState): void {
    if (state.isDead) {
      this.root.visible = false;
      return;
    }
    this.root.visible = true;

    if (state.state !== undefined) {
      if (state.state !== this.lastState) {
        this.stateTicks = 0;
        this.lastState = state.state;
      } else {
        this.stateTicks += 1;
      }
    }

    const pose: Pose =
      state.state !== undefined && state.character !== undefined && state.anim !== undefined
        ? computePose({
            state: state.state,
            stateTicks: this.stateTicks,
            moveId: state.moveId ?? -1,
            moveFrame: state.moveFrame ?? 0,
            hitstun: state.hitstun,
            facing: state.facing,
            character: state.character,
            anim: state.anim,
          } satisfies PoseInput)
        : NEUTRAL_POSE;

    this.body.rotation = pose.bodyLean;
    this.body.scale.set(pose.bodyScaleX, pose.bodyScaleY);
    this.body.position.set(0, -pose.bodyBob);

    const g = this.body;
    g.clear();

    // Base tint: danger-red while in hitstun (existing behaviour), else
    // the fighter's own colour blended toward a bright flash colour for
    // the brief post-hit window -- the flash reads as "impact" even after
    // hitstun itself has ended (hitstun on a light jab can be very short).
    const flash = state.flashAmount ?? 0;
    const baseTint = state.hitstun > 0 ? PALETTE.danger : this.bodyColor;
    const tint = flash > 0 ? lerpColor(baseTint, PALETTE.hud, flash * 0.85) : baseTint;

    if (state.characterName === 'Ballast') {
      drawBallastSilhouette(g, tint, state.facing, pose);
    } else if (state.characterName === 'Voltling') {
      drawVoltlingSilhouette(g, tint, state.facing, pose);
    } else {
      drawPlaceholderSilhouette(g, tint, state.facing, pose);
    }

    this.shieldGfx.clear();
    if (state.shieldActive) this.drawShieldBubble(state);
  }

  private drawShieldBubble(state: FighterVisualState): void {
    const r = BODY_WIDTH * 0.95;
    this.shieldGfx.circle(0, -BODY_HEIGHT / 2, r);
    this.shieldGfx.stroke({ color: PALETTE.hud, width: 2, alpha: 0.5 + 0.5 * state.shieldHealthFrac });
    this.shieldGfx.fill({ color: PALETTE.hud, alpha: 0.08 + 0.1 * state.shieldHealthFrac });
  }
}

function drawPlaceholderSilhouette(g: Graphics, tint: number, facing: 1 | -1, pose: Pose): void {
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
