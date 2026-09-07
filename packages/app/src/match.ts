// Glue: owns the Sim, the InputManager, and the Renderer, and drives them
// from the fixed-timestep loop. Iterates fighters by NUM_FIGHTERS (from
// the sim) rather than assuming 2, so the app layer isn't what blocks a
// future N-fighter sim.
import {
  Sim,
  NUM_FIGHTERS,
  fixed as fx,
  hashStateBuffer,
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
  type InputFrame,
} from '@bash-fighter/sim';
import { PLACEHOLDER_CHARACTER } from '@bash-fighter/content';
import { InputManager } from '@bash-fighter/input';
import { Renderer, type RenderFighterState, type RenderFrame, type StageBounds } from '@bash-fighter/render';
import { FixedTimestepLoop } from './loop.ts';

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
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Runs one local match: fixed 60Hz sim + interpolated render + input
 * sampling. Fighter count comes from NUM_FIGHTERS, read once, not 2
 * literals scattered through this file. */
export class Match {
  readonly sim: Sim;
  readonly characters: CharacterData[];
  readonly input = new InputManager();
  readonly renderer: Renderer;
  private readonly loop: FixedTimestepLoop;
  private prevSnapshots: FighterSnapshot[];
  private currSnapshots: FighterSnapshot[];
  private lastStocks: number[];
  private over = false;
  private readonly hashBuf: StateBuffer;

  constructor(
    parent: HTMLElement,
    characters: CharacterData[] = new Array(NUM_FIGHTERS).fill(PLACEHOLDER_CHARACTER),
    seed: number = 1,
    private readonly events: MatchEvents = {},
  ) {
    this.characters = characters;
    this.sim = new Sim(seed, characters as [CharacterData, CharacterData]);
    this.renderer = new Renderer(STAGE_BOUNDS);
    this.prevSnapshots = this.snapshotAll();
    this.currSnapshots = this.snapshotAll();
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
    for (let i = 0; i < NUM_FIGHTERS; i++) out.push(this.sim.getFighter(i));
    return out;
  }

  private tick(): void {
    if (this.over) return;
    const inputs: InputFrame[] = this.input.poll();
    this.sim.advance(inputs);

    this.prevSnapshots = this.currSnapshots;
    this.currSnapshots = this.snapshotAll();

    for (let i = 0; i < NUM_FIGHTERS; i++) {
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
    for (let i = 0; i < NUM_FIGHTERS; i++) {
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
    const frame: RenderFrame = {
      fighters,
      characters: this.characters,
      tick: this.sim.getTick(),
      hash: this.currentHash(),
    };
    this.renderer.render(frame);
  }

  currentSnapshots(): readonly FighterSnapshot[] {
    return this.currSnapshots;
  }

  private currentHash(): string {
    this.sim.saveState(this.hashBuf);
    return hashStateBuffer(this.hashBuf);
  }
}
