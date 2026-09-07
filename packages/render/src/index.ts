// packages/render: PixiJS/WebGL2 renderer. Reads sim state (already
// interpolated by the caller) and draws it; never mutates sim state.
// Built for N fighters — the sim milestone is fixed at 2, but nothing
// here hardcodes that so the renderer isn't what blocks 20-player FFA.
import { Application, Container, Graphics } from 'pixi.js';
import { fixed as fx, FighterStateId, type CharacterData, type FighterStateValue } from '@bash-fighter/sim';
import { PALETTE } from './palette.ts';
import { computeCamera, worldToScreen, type CameraConfig } from './camera.ts';
import { drawStage, type StageBounds } from './stage.ts';
import { FighterSprite } from './fighter-sprite.ts';
import { drawDebugBoxes, makeDebugText, formatDebugText, type DebugFighterInput } from './debug-overlay.ts';

export type { StageBounds } from './stage.ts';
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
}

export interface RenderFrame {
  fighters: readonly RenderFighterState[];
  characters: readonly CharacterData[];
  tick: number;
  hash: string;
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
  private readonly debugText = makeDebugText();
  private readonly stageBounds: StageBounds;

  constructor(stageBounds: StageBounds) {
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
    this.world.addChild(this.spriteContainer);
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

  render(frame: RenderFrame): void {
    if (!this.ready) return;
    const { width: vw, height: vh } = this.viewSize;
    const n = frame.fighters.length;
    this.ensureSpritePool(n);

    const cam = computeCamera(
      frame.fighters.map((f) => ({ x: f.x, y: f.y })),
      cameraConfig(this.stageBounds, vw, vh),
    );

    drawStage(this.stageLayer, this.stageBounds, cam, vw, vh);

    for (let i = 0; i < n; i++) {
      const f = frame.fighters[i] as RenderFighterState;
      const sprite = this.sprites[i] as FighterSprite;
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

    if (this.debugOn) {
      const debugInputs: DebugFighterInput[] = frame.fighters.map((f, i) => ({
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
