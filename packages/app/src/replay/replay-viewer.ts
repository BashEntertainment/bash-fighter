// Minimal replay viewer for issue #3: "recorded fixtures exist but there's
// no UI to watch one". Reuses the recorded deterministic input-stream
// fixtures that already back packages/sim's determinism/golden tests
// (packages/sim/test/fixtures/replay-input-stream*.ts) instead of
// inventing a new recording format, and reuses packages/render's real
// Renderer instead of building a second one -- this is a *player* for
// data that already exists, not a new recorder.
//
// Approach: run the whole fixture's recorded InputFrame[][] through a
// fresh Sim once up front, snapshotting fighters/items/hazards every
// tick. Playback then just walks that precomputed frame array -- this
// makes scrubbing trivial (jump to any tick instantly) without needing
// to re-simulate or reverse a live Sim, and keeps this file entirely
// read-only with respect to packages/sim (no simulation-logic changes,
// no golden fixture regeneration).
import {
  Sim,
  fixed as fx,
  MAX_ITEMS,
  MAX_HAZARDS,
  type InputFrame,
  type CharacterData,
  type ArenaData,
} from '@bash-fighter/sim';
import {
  Renderer,
  arenaDataToStageBounds,
  type RenderFighterState,
  type RenderItemState,
  type RenderHazardState,
  type RenderFrame,
} from '@bash-fighter/render';

// Item HELD/ARMED state ids mirror packages/sim/src/sim.ts's private
// ItemState enum -- same duplication match.ts already carries (see the
// comment there) since the sim package does not export it.
const ITEM_STATE_HELD = 1;
const ITEM_STATE_ARMED = 3;

export interface ReplayFixture {
  id: string;
  label: string;
  description: string;
  seed: number;
  characters: readonly CharacterData[];
  arena?: ArenaData;
  settings: ConstructorParameters<typeof Sim>[4];
  buildInputStream(): InputFrame[][];
}

interface ReplayTickFrame {
  fighters: RenderFighterState[];
  items: RenderItemState[];
  hazards: RenderHazardState[];
  tick: number;
  liveArenaBounds: { minX: number; maxX: number; minY: number; maxY: number };
}

/** Runs the fixture's full recorded input stream through a fresh Sim once,
 * capturing one RenderFrame-shaped snapshot per tick. Pure/read-only: does
 * not touch or depend on any live app state. */
function precomputeFrames(fixture: ReplayFixture): { frames: ReplayTickFrame[]; characters: CharacterData[] } {
  const sim = new Sim(fixture.seed, fixture.characters.length, fixture.characters, fixture.arena, fixture.settings);
  const frames: ReplayTickFrame[] = [];
  for (const inputs of fixture.buildInputStream()) {
    sim.advance(inputs);

    const fighters: RenderFighterState[] = [];
    for (let i = 0; i < fixture.characters.length; i++) {
      const s = sim.getFighter(i);
      fighters.push({
        x: fx.toFloat(s.posX),
        y: fx.toFloat(s.posY),
        facing: s.facing,
        state: s.state,
        moveId: s.moveId,
        moveFrame: s.moveFrame,
        percent: s.percent,
        stocks: s.stocks,
        shieldHealth: s.shieldHealth,
        hitstun: s.hitstun,
        eliminated: s.eliminated,
        inRingDanger: s.inRingDanger,
      });
    }

    const items: RenderItemState[] = [];
    for (let i = 0; i < MAX_ITEMS; i++) {
      const it = sim.getItem(i);
      if (!it.active) {
        items.push({ active: false, typeId: 0, x: 0, y: 0, held: false, holderFacing: 1, armed: false, fuseTicks: 0 });
        continue;
      }
      const held = it.state === ITEM_STATE_HELD;
      let x = fx.toFloat(it.posX);
      let y = fx.toFloat(it.posY);
      let holderFacing: 1 | -1 = 1;
      if (held && it.holder >= 0 && it.holder < fixture.characters.length) {
        const hf = fighters[it.holder] as RenderFighterState;
        x = hf.x;
        y = hf.y;
        holderFacing = hf.facing;
      }
      items.push({
        active: true,
        typeId: it.typeId,
        x,
        y,
        held,
        holderFacing,
        armed: it.state === ITEM_STATE_ARMED,
        fuseTicks: it.fuse,
      });
    }

    const hazards: RenderHazardState[] = [];
    for (let i = 0; i < MAX_HAZARDS; i++) {
      const hz = sim.getHazard(i);
      hazards.push(
        hz.active
          ? { active: true, x: fx.toFloat(hz.posX), y: fx.toFloat(hz.posY), halfWidth: 11 }
          : { active: false, x: 0, y: 0, halfWidth: 11 },
      );
    }

    const rect = sim.getCurrentBlastRect();
    frames.push({
      fighters,
      items,
      hazards,
      tick: sim.getTick(),
      liveArenaBounds: {
        minX: fx.toFloat(rect.minX),
        maxX: fx.toFloat(rect.maxX),
        minY: fx.toFloat(rect.minY),
        maxY: fx.toFloat(rect.maxY),
      },
    });
  }
  return { frames, characters: sim.getArena() ? [...fixture.characters] : [...fixture.characters] };
}

/** Plays back one precomputed replay fixture through the real renderer.
 * Play/pause/scrub only -- no live input, no networking, no audio. */
export class ReplayViewer {
  private readonly renderer: Renderer;
  private readonly frames: ReplayTickFrame[];
  private readonly characters: CharacterData[];
  private index = 0;
  private playing = false;
  private rafHandle = 0;
  private lastTimeMs: number | null = null;
  private accumulatorMs = 0;
  private readonly stepMs = 1000 / 60;

  constructor(
    private readonly sim: Sim,
    fixture: ReplayFixture,
    precomputed: { frames: ReplayTickFrame[]; characters: CharacterData[] },
  ) {
    void fixture;
    this.frames = precomputed.frames;
    this.characters = precomputed.characters;
    this.renderer = new Renderer(arenaDataToStageBounds(sim.getArena()));
  }

  static create(fixture: ReplayFixture): ReplayViewer {
    const sim = new Sim(fixture.seed, fixture.characters.length, fixture.characters, fixture.arena, fixture.settings);
    const precomputed = precomputeFrames(fixture);
    return new ReplayViewer(sim, fixture, precomputed);
  }

  get totalTicks(): number {
    return this.frames.length;
  }

  get currentTick(): number {
    return this.index;
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  async init(parent: HTMLElement): Promise<void> {
    await this.renderer.init(parent);
    this.renderCurrent();
  }

  play(): void {
    if (this.playing) return;
    if (this.index >= this.frames.length - 1) this.index = 0;
    this.playing = true;
    this.lastTimeMs = null;
    this.accumulatorMs = 0;
    this.rafHandle = requestAnimationFrame(this.frame);
  }

  pause(): void {
    this.playing = false;
    cancelAnimationFrame(this.rafHandle);
  }

  togglePlay(): void {
    if (this.playing) this.pause();
    else this.play();
  }

  /** Jump to an absolute tick (scrub). Clamped to the recorded range. */
  seekTo(tick: number): void {
    this.index = Math.max(0, Math.min(this.frames.length - 1, Math.round(tick)));
    this.renderCurrent();
  }

  stepOnce(delta: number): void {
    this.seekTo(this.index + delta);
  }

  destroy(): void {
    this.pause();
  }

  private readonly frame = (nowMs: number): void => {
    if (!this.playing) return;
    if (this.lastTimeMs === null) this.lastTimeMs = nowMs;
    let deltaMs = nowMs - this.lastTimeMs;
    this.lastTimeMs = nowMs;
    if (deltaMs > 250) deltaMs = 250;
    this.accumulatorMs += deltaMs;
    while (this.accumulatorMs >= this.stepMs) {
      this.accumulatorMs -= this.stepMs;
      this.index += 1;
      if (this.index >= this.frames.length - 1) {
        this.index = this.frames.length - 1;
        this.playing = false;
        this.renderCurrent();
        return;
      }
    }
    this.renderCurrent();
    if (this.playing) this.rafHandle = requestAnimationFrame(this.frame);
  };

  private renderCurrent(): void {
    const f = this.frames[this.index] as ReplayTickFrame;
    const renderFrame: RenderFrame = {
      fighters: f.fighters,
      characters: this.characters,
      items: f.items,
      hazards: f.hazards,
      tick: f.tick,
      hash: '',
      liveArenaBounds: f.liveArenaBounds,
    };
    this.renderer.render(renderFrame);
  }
}
