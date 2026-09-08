// Glue: owns the Sim, the InputManager, and the Renderer, and drives them
// from the fixed-timestep loop. Iterates fighters by this.sim.numFighters (
// the sim) rather than assuming 2, so the app layer isn't what blocks a
// future N-fighter sim.
import {
  Sim,
  fixed as fx,
  hashStateBuffer,
  MAX_ITEMS,
  MAX_HAZARDS,
  type StateBuffer,
  STAGE_MIN_X,
  STAGE_MAX_X,
  BLAST_MIN_X,
  BLAST_MAX_X,
  BLAST_MIN_Y,
  BLAST_MAX_Y,
  GROUND_Y,
  type CharacterData,
  type FighterSnapshot,
  type ItemSnapshot,
  type HazardSnapshot,
  type InputFrame,
} from '@bash-fighter/sim';
import { PLACEHOLDER_CHARACTER } from '@bash-fighter/content';
import { InputManager } from '@bash-fighter/input';
import {
  Renderer,
  type RenderFighterState,
  type RenderItemState,
  type RenderHazardState,
  type RenderFrame,
  type StageBounds,
} from '@bash-fighter/render';
import { FixedTimestepLoop } from './loop.ts';

// Item HELD state id (mirrors packages/sim/src/sim.ts's private ItemState
// enum: 0=world, 1=held, 2=thrown, 3=armed). Not exported by the sim
// package, so duplicated here as a stable numeric constant rather than
// widening the sim's public surface for a render-only concern.
const ITEM_STATE_HELD = 1;
const ITEM_STATE_ARMED = 3;

// Stylized world-unit marker size for the hazard's ground-impact
// indicator — matches the general scale FighterSprite/ItemSprite use
// (BODY_WIDTH=14), not a pixel-exact readout of the sim's hazard hitbox.
const HAZARD_MARKER_HALF_WIDTH = 11;

export const STAGE_BOUNDS: StageBounds = {
  stageMinX: fx.toFloat(STAGE_MIN_X),
  stageMaxX: fx.toFloat(STAGE_MAX_X),
  groundY: fx.toFloat(GROUND_Y),
  blastMinX: fx.toFloat(BLAST_MIN_X),
  blastMaxX: fx.toFloat(BLAST_MAX_X),
  blastMinY: fx.toFloat(BLAST_MIN_Y),
  blastMaxY: fx.toFloat(BLAST_MAX_Y),
};

export interface MatchEvents {
  onStockLost?(fighterIndex: number, stocksRemaining: number): void;
  onMatchOver?(winnerIndex: number | null): void;
  /** Runs right before a frame is handed to the renderer. Lets the app
   * layer (spectator camera, elimination flags) rewrite the frame
   * without the Match/Renderer needing to know about spectate policy. */
  transformFrame?(frame: RenderFrame): RenderFrame;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Runs one local match: fixed 60Hz sim + interpolated render + input
 * sampling. Fighter count comes from this.sim.numFighters, read once, not 2
 * literals scattered through this file. */
export class Match {
  readonly sim: Sim;
  readonly characters: CharacterData[];
  readonly input = new InputManager();
  readonly renderer: Renderer;
  private readonly loop: FixedTimestepLoop;
  private prevSnapshots: FighterSnapshot[];
  private currSnapshots: FighterSnapshot[];
  private prevItemSnapshots: ItemSnapshot[];
  private currItemSnapshots: ItemSnapshot[];
  private prevHazardSnapshots: HazardSnapshot[];
  private currHazardSnapshots: HazardSnapshot[];
  private lastStocks: number[];
  private over = false;
  private readonly hashBuf: StateBuffer;

  private readonly numFighters: number;

  constructor(
    parent: HTMLElement,
    characters: CharacterData[] = new Array(2).fill(PLACEHOLDER_CHARACTER),
    seed: number = 1,
    private readonly events: MatchEvents = {},
    sim?: Sim,
  ) {
    this.characters = characters;
    this.sim = sim ?? new Sim(seed, characters.length, characters);
    this.numFighters = this.sim.numFighters;
    this.renderer = new Renderer(STAGE_BOUNDS);
    this.prevSnapshots = this.snapshotAll();
    this.currSnapshots = this.snapshotAll();
    this.prevItemSnapshots = this.snapshotItems();
    this.currItemSnapshots = this.snapshotItems();
    this.prevHazardSnapshots = this.snapshotHazards();
    this.currHazardSnapshots = this.snapshotHazards();
    this.lastStocks = this.currSnapshots.map((s) => s.stocks);
    this.hashBuf = this.sim.createStateBuffer();
    this.loop = new FixedTimestepLoop(
      () => this.tick(),
      (alpha) => this.renderFrame(alpha),
    );
    void parent;
  }

  async init(parent: HTMLElement): Promise<void> {
    await this.renderer.init(parent);
    this.input.attach(window);
  }

  start(): void {
    this.loop.start();
  }

  stop(): void {
    this.loop.stop();
    this.input.detach(window);
  }

  setDebug(on: boolean): void {
    this.renderer.setDebug(on);
  }

  toggleDebug(): void {
    this.renderer.setDebug(!this.renderer.isDebug());
  }

  private snapshotAll(): FighterSnapshot[] {
    const out: FighterSnapshot[] = [];
    for (let i = 0; i < this.numFighters; i++) out.push(this.sim.getFighter(i));
    return out;
  }

  private snapshotItems(): ItemSnapshot[] {
    const out: ItemSnapshot[] = [];
    for (let i = 0; i < MAX_ITEMS; i++) out.push(this.sim.getItem(i));
    return out;
  }

  private snapshotHazards(): HazardSnapshot[] {
    const out: HazardSnapshot[] = [];
    for (let i = 0; i < MAX_HAZARDS; i++) out.push(this.sim.getHazard(i));
    return out;
  }

  private tick(): void {
    if (this.over) return;
    const inputs: InputFrame[] = this.input.poll();
    this.sim.advance(inputs);

    this.prevSnapshots = this.currSnapshots;
    this.currSnapshots = this.snapshotAll();
    this.prevItemSnapshots = this.currItemSnapshots;
    this.currItemSnapshots = this.snapshotItems();
    this.prevHazardSnapshots = this.currHazardSnapshots;
    this.currHazardSnapshots = this.snapshotHazards();

    for (let i = 0; i < this.numFighters; i++) {
      const stocks = (this.currSnapshots[i] as FighterSnapshot).stocks;
      if (stocks < (this.lastStocks[i] as number)) {
        this.events.onStockLost?.(i, stocks);
      }
      this.lastStocks[i] = stocks;
    }

    if (this.sim.isMatchOver() && !this.over) {
      this.over = true;
      this.events.onMatchOver?.(this.sim.getWinner());
    }
  }

  private renderFrame(alpha: number): void {
    const fighters: RenderFighterState[] = [];
    for (let i = 0; i < this.numFighters; i++) {
      const prev = this.prevSnapshots[i] as FighterSnapshot;
      const curr = this.currSnapshots[i] as FighterSnapshot;
      fighters.push({
        x: lerp(fx.toFloat(prev.posX), fx.toFloat(curr.posX), alpha),
        y: lerp(fx.toFloat(prev.posY), fx.toFloat(curr.posY), alpha),
        facing: curr.facing,
        state: curr.state,
        moveId: curr.moveId,
        moveFrame: curr.moveFrame,
        percent: curr.percent,
        stocks: curr.stocks,
        shieldHealth: curr.shieldHealth,
        hitstun: curr.hitstun,
      });
    }
    const items: RenderItemState[] = [];
    for (let i = 0; i < MAX_ITEMS; i++) {
      const prev = this.prevItemSnapshots[i] as ItemSnapshot;
      const curr = this.currItemSnapshots[i] as ItemSnapshot;
      if (!curr.active) {
        items.push({ active: false, typeId: 0, x: 0, y: 0, held: false, holderFacing: 1, armed: false, fuseTicks: 0 });
        continue;
      }
      const held = curr.state === ITEM_STATE_HELD;
      // Held items snap to the holder's interpolated position instead of
      // lerping the item's own prev/curr (which jump when pickup/drop
      // changes ownership) so they never visually detach from the hand.
      let x: number;
      let y: number;
      let holderFacing: 1 | -1 = 1;
      if (held && curr.holder >= 0 && curr.holder < this.numFighters) {
        const hf = fighters[curr.holder] as RenderFighterState;
        x = hf.x;
        y = hf.y;
        holderFacing = hf.facing;
      } else if (prev.active) {
        x = lerp(fx.toFloat(prev.posX), fx.toFloat(curr.posX), alpha);
        y = lerp(fx.toFloat(prev.posY), fx.toFloat(curr.posY), alpha);
      } else {
        x = fx.toFloat(curr.posX);
        y = fx.toFloat(curr.posY);
      }
      items.push({
        active: true,
        typeId: curr.typeId,
        x,
        y,
        held,
        holderFacing,
        armed: curr.state === ITEM_STATE_ARMED,
        fuseTicks: curr.fuse,
      });
    }

    const hazards: RenderHazardState[] = [];
    for (let i = 0; i < MAX_HAZARDS; i++) {
      const prev = this.prevHazardSnapshots[i] as HazardSnapshot;
      const curr = this.currHazardSnapshots[i] as HazardSnapshot;
      if (!curr.active) {
        hazards.push({ active: false, x: 0, y: 0, halfWidth: HAZARD_MARKER_HALF_WIDTH });
        continue;
      }
      const x = prev.active ? lerp(fx.toFloat(prev.posX), fx.toFloat(curr.posX), alpha) : fx.toFloat(curr.posX);
      const y = prev.active ? lerp(fx.toFloat(prev.posY), fx.toFloat(curr.posY), alpha) : fx.toFloat(curr.posY);
      hazards.push({ active: true, x, y, halfWidth: HAZARD_MARKER_HALF_WIDTH });
    }

    const frame: RenderFrame = {
      fighters,
      characters: this.characters,
      items,
      hazards,
      tick: this.sim.getTick(),
      hash: this.currentHash(),
    };
    this.renderer.render(this.events.transformFrame ? this.events.transformFrame(frame) : frame);
  }

  currentSnapshots(): readonly FighterSnapshot[] {
    return this.currSnapshots;
  }

  private currentHash(): string {
    this.sim.saveState(this.hashBuf);
    return hashStateBuffer(this.hashBuf);
  }
}
