// Replay viewer screen: pick a recorded fixture, watch it play back
// through the real renderer, play/pause/scrub. Reachable from the start
// screen so issue #3 ("no UI to watch one") has an actual, discoverable
// answer rather than a hidden dev page.
import { REPLAY_FIXTURES } from '../replay/fixtures.ts';
import { ReplayViewer } from '../replay/replay-viewer.ts';

export class ReplayScreen {
  readonly root: HTMLDivElement;
  private readonly pickerEl: HTMLDivElement;
  private readonly playerEl: HTMLDivElement;
  private readonly canvasMount: HTMLDivElement;
  private readonly scrubEl: HTMLInputElement;
  private readonly tickLabel: HTMLSpanElement;
  private readonly playBtn: HTMLButtonElement;
  private viewer: ReplayViewer | null = null;
  private rafHandle = 0;

  constructor(
    parent: HTMLElement,
    private readonly onBack: () => void,
  ) {
    this.root = document.createElement('div');
    this.root.className = 'screen hidden';
    this.root.id = 'replay-screen';
    this.root.innerHTML = `
      <div class="wordmark">REPLAYS</div>
      <div class="subtitle">Watch a recorded match play back. These are the same deterministic fixtures the test suite replays to catch regressions.</div>
      <button class="btn btn-secondary" id="replay-picker-back-btn">Back</button>
      <div id="replay-picker" class="replay-picker"></div>
      <div id="replay-player" class="replay-player hidden">
        <div id="replay-canvas-mount" class="replay-canvas-mount"></div>
        <div class="replay-controls">
          <button class="btn btn-secondary" id="replay-play-btn">Play</button>
          <input type="range" id="replay-scrub" min="0" max="0" value="0" step="1" />
          <span id="replay-tick-label" class="replay-tick-label">tick 0 / 0</span>
          <button class="btn btn-secondary" id="replay-back-btn">Back</button>
        </div>
      </div>
    `;
    parent.appendChild(this.root);

    this.pickerEl = this.root.querySelector('#replay-picker') as HTMLDivElement;
    this.playerEl = this.root.querySelector('#replay-player') as HTMLDivElement;
    this.canvasMount = this.root.querySelector('#replay-canvas-mount') as HTMLDivElement;
    this.scrubEl = this.root.querySelector('#replay-scrub') as HTMLInputElement;
    this.tickLabel = this.root.querySelector('#replay-tick-label') as HTMLSpanElement;
    this.playBtn = this.root.querySelector('#replay-play-btn') as HTMLButtonElement;

    for (const fixture of REPLAY_FIXTURES) {
      const card = document.createElement('button');
      card.className = 'btn btn-secondary replay-fixture-card';
      card.innerHTML = `<strong>${fixture.label}</strong><br /><span>${fixture.description}</span>`;
      card.addEventListener('click', () => void this.loadFixture(fixture.id));
      this.pickerEl.appendChild(card);
    }

    this.playBtn.addEventListener('click', () => this.viewer?.togglePlay());
    this.scrubEl.addEventListener('input', () => this.viewer?.seekTo(Number(this.scrubEl.value)));
    (this.root.querySelector('#replay-back-btn') as HTMLButtonElement).addEventListener('click', () => {
      this.stopViewer();
      this.hide();
      this.onBack();
    });
    (this.root.querySelector('#replay-picker-back-btn') as HTMLButtonElement).addEventListener('click', () => {
      this.hide();
      this.onBack();
    });
  }

  private async loadFixture(id: string): Promise<void> {
    const fixture = REPLAY_FIXTURES.find((f) => f.id === id);
    if (!fixture) return;
    this.stopViewer();
    this.canvasMount.innerHTML = '';
    const viewer = ReplayViewer.create(fixture);
    await viewer.init(this.canvasMount);
    this.viewer = viewer;
    this.scrubEl.max = String(viewer.totalTicks - 1);
    this.scrubEl.value = '0';
    // Hide the fixture picker once a replay is loaded -- otherwise it
    // keeps its full height above the player, pushing the canvas and
    // Play/scrub/Back controls hundreds of pixels below the fold with
    // nothing on screen to tell the player anything happened.
    this.pickerEl.classList.add('hidden');
    this.playerEl.classList.remove('hidden');
    viewer.play();
    this.tickUiLoop();
  }

  private tickUiLoop(): void {
    const step = (): void => {
      if (!this.viewer) return;
      this.scrubEl.value = String(this.viewer.currentTick);
      this.tickLabel.textContent = `tick ${this.viewer.currentTick} / ${this.viewer.totalTicks - 1}`;
      this.playBtn.textContent = this.viewer.isPlaying ? 'Pause' : 'Play';
      this.rafHandle = requestAnimationFrame(step);
    };
    cancelAnimationFrame(this.rafHandle);
    this.rafHandle = requestAnimationFrame(step);
  }

  private stopViewer(): void {
    cancelAnimationFrame(this.rafHandle);
    this.viewer?.destroy();
    this.viewer = null;
    this.playerEl.classList.add('hidden');
    this.pickerEl.classList.remove('hidden');
  }

  show(): void {
    this.root.classList.remove('hidden');
  }

  hide(): void {
    this.stopViewer();
    this.root.classList.add('hidden');
  }
}
