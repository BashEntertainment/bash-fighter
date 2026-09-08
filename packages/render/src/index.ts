// packages/render: PixiJS/WebGL2 renderer. Reads sim state (already
// interpolated by the caller) and draws it; never mutates sim state.
// Built for N fighters — the sim milestone is fixed at 2, but nothing
// here hardcodes that so the renderer isn't what blocks 20-player FFA.
import { Application, Container, Graphics } from 'pixi.js';
import { fixed as fx, FighterStateId, type CharacterData, type FighterStateValue } from '@bash-fighter/sim';
import { PALETTE } from './palette.ts';
import { computeCamera, worldToScreen, type ArenaBounds, type CameraConfig, type CameraView } from './camera.ts';
import { drawStage, type StageBounds } from './stage.ts';
import { FighterSprite } from './fighter-sprite.ts';
import { ItemSprite } from './item-sprite.ts';
import { HazardSprite } from './hazard-sprite.ts';
import { drawDebugBoxes, makeDebugText, formatDebugText, type DebugFighterInput } from './debug-overlay.ts';

export { RenderItemTypeId } from './item-sprite.ts';

export type { StageBounds, StagePlatform } from './stage.ts';
export { arenaDataToStageBounds } from './arena-adapter.ts';
export type { ArenaBounds, CameraView, CameraConfig } from './camera.ts';
export { computeCamera, worldToScreen } from './camera.ts';
export { computeFollowCamera, computeOverviewCamera, SmoothedCamera, type FollowConfig } from './spectator-camera.ts';
export { PALETTE, FONT_FAMILY, UI_FONT_FAMILY } from './palette.ts';

/** One fighter's render-ready state: world-space floats, already
 * interpolated between the two most recent sim ticks by the app layer. */
export interface RenderFighterState {
  x: number;
  y: number;
  facing: 1 | -1;
  state: FighterStateValue;
  moveId: number;
  moveFrame: number;
  percent: number; // Fixed
  stocks: number;
  shieldHealth: number; // Fixed
  hitstun: number;
  /** Match-level elimination (battle-royale "out"), distinct from the
   * sim's per-life DEAD state. An eliminated fighter is never drawn. */
  eliminated?: boolean;
}

/** One item's render-ready state: world-space floats, already read from
 * sim.getItem(slot) by the app layer. `active: false` slots are skipped
 * by the renderer (pool entry hidden), same convention as fighters. */
export interface RenderItemState {
  active: boolean;
  typeId: number;
  x: number;
  y: number;
  held: boolean;
  holderFacing: 1 | -1;
  armed: boolean;
  fuseTicks: number;
}

/** One hazard's render-ready state, from sim.getHazard(slot). halfWidth
 * is a stylized world-unit marker size chosen by the app layer for
 * legibility, same convention as FighterSprite's BODY_WIDTH (not a
 * pixel-exact readout of the sim's hazard hitbox). */
export interface RenderHazardState {
  active: boolean;
  x: number;
  y: number;
  halfWidth: number;
}

export interface RenderFrame {
  fighters: readonly RenderFighterState[];
  characters: readonly CharacterData[];
  items?: readonly RenderItemState[];
  hazards?: readonly RenderHazardState[];
  tick: number;
  hash: string;
  /** Live arena bounds (e.g. a shrinking battle-royale blast zone) to
   * draw and frame instead of the static stage bounds. Falls back to the
   * Renderer's static StageBounds-derived arena when omitted. */
  liveArenaBounds?: ArenaBounds;
  /** When set, the renderer paints with this exact camera instead of
   * computing its own fit-everyone camera. This is how the app layer's
   * spectator camera (follow / overview / smoothed) takes over — the
   * renderer stays a dumb painter and never decides spectate policy. */
  cameraOverride?: CameraView;
}

// Fighters spread by roughly a screen-width during normal play; a
// paddingWorld a bit smaller than the arena keeps the baseline "whole
// arena" framing from [[camera.ts]] as the default rather than the
// exception. minScale keeps fighters legible even on a wide arena;
// maxScale stops the camera slamming in when fighters stand still.
function cameraConfig(stage: StageBounds, viewWidth: number, viewHeight: number): CameraConfig {
  return {
    viewWidth,
    viewHeight,
    minScale: 1.6,
    maxScale: 5.5,
    paddingWorld: 20,
    arena: {
      minX: stage.blastMinX,
      maxX: stage.blastMaxX,
      minY: stage.blastMinY,
      maxY: stage.blastMaxY,
    },
  };
}

function mainGroundY(stage: StageBounds): number {
  return stage.platforms[0]?.y ?? 0;
}

const PLAYER_COLOR_COUNT = PALETTE.fighters.length;

export class Renderer {
  readonly app = new Application();
  private ready = false;
  private debugOn = false;

  private readonly world = new Container();
  private readonly stageLayer = new Graphics();
  private readonly debugLayer = new Graphics();
  private readonly sprites: FighterSprite[] = [];
  private readonly spriteContainer = new Container();
  private readonly itemSprites: ItemSprite[] = [];
  private readonly itemContainer = new Container();
  private readonly hazardSprites: HazardSprite[] = [];
  private readonly hazardContainer = new Container();
  private readonly debugText = makeDebugText();
  private stageBounds: StageBounds;

  constructor(stageBounds: StageBounds) {
    this.stageBounds = stageBounds;
  }

  /** Swap the static arena the renderer draws, e.g. once an online match's
   * real arena (createMatchSim's BATTLE_ROYALE_20_ARENA) is known, after
   * the Renderer had to be constructed earlier with a placeholder. */
  setStageBounds(stageBounds: StageBounds): void {
    this.stageBounds = stageBounds;
  }

  async init(parent: HTMLElement): Promise<void> {
    await this.app.init({
      resizeTo: parent,
      background: PALETTE.background,
      antialias: true,
      preference: 'webgl',
    });
    parent.appendChild(this.app.canvas);

    this.world.addChild(this.stageLayer);
    this.world.addChild(this.hazardContainer);
    this.world.addChild(this.spriteContainer);
    this.world.addChild(this.itemContainer);
    this.world.addChild(this.debugLayer);
    this.app.stage.addChild(this.world);

    this.debugText.position.set(10, 130);
    this.debugText.visible = false;
    this.app.stage.addChild(this.debugText);

    this.ready = true;
  }

  setDebug(on: boolean): void {
    this.debugOn = on;
    this.debugText.visible = on;
  }

  isDebug(): boolean {
    return this.debugOn;
  }

  get viewSize(): { width: number; height: number } {
    return { width: this.app.renderer.width, height: this.app.renderer.height };
  }

  /** Pool a sprite per fighter slot — created once, reused every frame so
   * a 20-fighter FFA doesn't allocate PIXI objects per tick. */
  private ensureSpritePool(count: number): void {
    while (this.sprites.length < count) {
      const sprite = new FighterSprite(this.sprites.length % PLAYER_COLOR_COUNT);
      this.sprites.push(sprite);
      this.spriteContainer.addChild(sprite.root);
    }
    for (let i = count; i < this.sprites.length; i++) {
      (this.sprites[i] as FighterSprite).root.visible = false;
    }
  }

  private ensureItemPool(count: number): void {
    while (this.itemSprites.length < count) {
      const sprite = new ItemSprite();
      this.itemSprites.push(sprite);
      this.itemContainer.addChild(sprite.root);
    }
    for (let i = count; i < this.itemSprites.length; i++) {
      (this.itemSprites[i] as ItemSprite).root.visible = false;
    }
  }

  private ensureHazardPool(count: number): void {
    while (this.hazardSprites.length < count) {
      const sprite = new HazardSprite();
      this.hazardSprites.push(sprite);
      this.hazardContainer.addChild(sprite.root);
    }
    for (let i = count; i < this.hazardSprites.length; i++) {
      (this.hazardSprites[i] as HazardSprite).root.visible = false;
    }
  }

  render(frame: RenderFrame): void {
    if (!this.ready) return;
    const { width: vw, height: vh } = this.viewSize;
    const liveFighters = frame.fighters.filter((f) => !f.eliminated);
    this.ensureSpritePool(frame.fighters.length);

    const stageForDraw: StageBounds = frame.liveArenaBounds
      ? {
          ...this.stageBounds,
          blastMinX: frame.liveArenaBounds.minX,
          blastMaxX: frame.liveArenaBounds.maxX,
          blastMinY: frame.liveArenaBounds.minY,
          blastMaxY: frame.liveArenaBounds.maxY,
        }
      : this.stageBounds;

    const cam =
      frame.cameraOverride ??
      computeCamera(
        liveFighters.map((f) => ({ x: f.x, y: f.y })),
        cameraConfig(stageForDraw, vw, vh),
      );

    drawStage(this.stageLayer, stageForDraw, cam, vw, vh);

    for (let i = 0; i < frame.fighters.length; i++) {
      const f = frame.fighters[i] as RenderFighterState;
      const sprite = this.sprites[i] as FighterSprite;
      if (f.eliminated) {
        sprite.root.visible = false;
        continue;
      }
      sprite.root.visible = true;
      const screen = worldToScreen(f.x, f.y, cam, vw, vh);
      sprite.root.position.set(screen.x, screen.y);
      sprite.root.scale.set(cam.scale); // silhouette is drawn in world units
      sprite.draw({
        facing: f.facing,
        hitstun: f.hitstun,
        shieldActive: f.state === FighterStateId.SHIELD,
        shieldHealthFrac: fx.toFloat(f.shieldHealth) / 100,
        isDead: f.state === FighterStateId.DEAD,
      });
    }

    const hazards = frame.hazards ?? [];
    this.ensureHazardPool(hazards.length);
    for (let i = 0; i < hazards.length; i++) {
      const h = hazards[i] as RenderHazardState;
      const sprite = this.hazardSprites[i] as HazardSprite;
      if (!h.active) {
        sprite.root.visible = false;
        continue;
      }
      sprite.root.visible = true;
      const screen = worldToScreen(h.x, h.y, cam, vw, vh);
      sprite.root.position.set(screen.x, screen.y);
      sprite.root.scale.set(cam.scale);
      sprite.draw({
        posX: h.x,
        posY: h.y,
        groundY: mainGroundY(stageForDraw),
        halfWidth: h.halfWidth,
      });
    }

    const items = frame.items ?? [];
    this.ensureItemPool(items.length);
    for (let i = 0; i < items.length; i++) {
      const it = items[i] as RenderItemState;
      const sprite = this.itemSprites[i] as ItemSprite;
      if (!it.active) {
        sprite.root.visible = false;
        continue;
      }
      sprite.root.visible = true;
      const screen = worldToScreen(it.x, it.y, cam, vw, vh);
      sprite.root.position.set(screen.x, screen.y);
      sprite.root.scale.set(cam.scale);
      sprite.draw({
        typeId: it.typeId,
        held: it.held,
        facing: it.holderFacing,
        armed: it.armed,
        fuseTicks: it.fuseTicks,
      });
    }

    if (this.debugOn) {
      const debugInputs: DebugFighterInput[] = frame.fighters
        .map((f, i) => ({ f, i }))
        .filter(({ f }) => !f.eliminated)
        .map(({ f, i }) => ({
          x: f.x,
          y: f.y,
          facing: f.facing,
          state: f.state,
          moveId: f.moveId,
          moveFrame: f.moveFrame,
          percent: f.percent,
          character: frame.characters[i] as CharacterData,
        }));
      drawDebugBoxes(this.debugLayer, debugInputs, cam, vw, vh);
      this.debugText.text = formatDebugText(debugInputs, frame.tick, frame.hash);
    } else {
      this.debugLayer.clear();
    }
  }

  destroy(): void {
    this.app.destroy(true, { children: true });
  }
}
