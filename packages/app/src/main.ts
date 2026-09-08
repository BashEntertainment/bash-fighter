import './style.css';
import { Match, STAGE_BOUNDS } from './match.ts';
import { StartScreen } from './ui/start-screen.ts';
import { WinScreen } from './ui/win-screen.ts';
import { Hud } from './ui/hud.ts';
import { SpectatorBanner } from './ui/spectator-banner.ts';
import { StubMatchAdapter } from './spectator/stub-adapter.ts';
import { SpectatorController } from './spectator/controller.ts';
import type { ArenaBounds } from '@bash-fighter/render';

// This local build has no networking, so "the local player" is just
// whichever slot we choose to watch from. Slot 0 (P1) is the one that,
// when eliminated, triggers the spectator experience — the mechanism is
// the same one a real client will use once matches have real players.
const LOCAL_SLOT = 0;

const STATIC_ARENA: ArenaBounds = {
  minX: STAGE_BOUNDS.blastMinX,
  maxX: STAGE_BOUNDS.blastMaxX,
  minY: STAGE_BOUNDS.blastMinY,
  maxY: STAGE_BOUNDS.blastMaxY,
};

const appRoot = document.getElementById('app') as HTMLDivElement;

const canvasRoot = document.createElement('div');
canvasRoot.id = 'canvas-root';
appRoot.appendChild(canvasRoot);

const debugHint = document.createElement('div');
debugHint.className = 'debug-hint';
debugHint.textContent = 'F3 debug · TAB cycle survivors · O overview';
appRoot.appendChild(debugHint);

let match: Match | null = null;
let adapter: StubMatchAdapter | null = null;
let spectator: SpectatorController | null = null;
let matchGeneration = 0;
let lastFrameTimeMs: number | null = null;

const hud = new Hud(appRoot);
const spectatorBanner = new SpectatorBanner(appRoot);

const startScreen = new StartScreen(appRoot, () => {
  void beginMatch();
});

const winScreen = new WinScreen(appRoot, () => {
  void beginMatch();
});

async function beginMatch(): Promise<void> {
  winScreen.hide();
  startScreen.hide();
  spectatorBanner.hide();
  hud.show();
  const generation = ++matchGeneration;
  lastFrameTimeMs = null;

  if (match) {
    match.stop();
    match.renderer.destroy();
    canvasRoot.innerHTML = '';
  }

  const localMatch: Match = new Match(canvasRoot, undefined, Date.now() & 0xffffffff, {
    onMatchOver: (winnerIndex) => {
      hud.hide();
      winScreen.show(winnerIndex);
      match?.stop();
    },
    transformFrame: (frame) => {
      const currentAdapter = adapter;
      const currentSpectator = spectator;
      if (!currentAdapter || !currentSpectator) return frame;
      currentAdapter.update();

      const fighters = frame.fighters.map((f, i) => ({ ...f, eliminated: currentAdapter.status(i).eliminated }));

      if (currentAdapter.status(LOCAL_SLOT).eliminated && !currentSpectator.isActive) {
        currentSpectator.activate();
        const status = currentAdapter.status(LOCAL_SLOT);
        spectatorBanner.show(status.placement ?? currentAdapter.fighterCount, currentAdapter.fighterCount);
      }

      if (!currentSpectator.isActive) {
        return { ...frame, fighters };
      }

      const now = performance.now();
      const dtSeconds = lastFrameTimeMs === null ? 1 / 60 : Math.min(0.1, (now - lastFrameTimeMs) / 1000);
      lastFrameTimeMs = now;

      const { width, height } = localMatch.renderer.viewSize;
      const arena = currentAdapter.liveArenaBounds() ?? STATIC_ARENA;
      const cameraOverride = currentSpectator.update({
        positions: fighters.map((f) => ({ x: f.x, y: f.y })),
        viewWidth: width,
        viewHeight: height,
        arena,
        dtSeconds,
      });

      return { ...frame, fighters, liveArenaBounds: arena, cameraOverride };
    },
  });
  match = localMatch;
  adapter = new StubMatchAdapter(localMatch);
  spectator = new SpectatorController(adapter, LOCAL_SLOT, {
    centerX: (STATIC_ARENA.minX + STATIC_ARENA.maxX) / 2,
    centerY: (STATIC_ARENA.minY + STATIC_ARENA.maxY) / 2,
    scale: 3,
  });

  await localMatch.init(canvasRoot);
  localMatch.start();

  const hudTick = (): void => {
    if (generation !== matchGeneration) return;
    if (match && adapter) {
      const extras = Array.from({ length: adapter.fighterCount }, (_, i) => {
        const status = (adapter as StubMatchAdapter).status(i);
        return { eliminated: status.eliminated, placement: status.placement };
      });
      hud.update(match.currentSnapshots(), extras);
    }
    requestAnimationFrame(hudTick);
  };
  requestAnimationFrame(hudTick);
}

window.addEventListener('keydown', (e) => {
  if (e.code === 'F3') {
    e.preventDefault();
    match?.toggleDebug();
  } else if (e.code === 'Tab' && spectator?.isActive) {
    e.preventDefault();
    spectator.cycleNext();
  } else if (e.code === 'KeyO' && spectator?.isActive) {
    e.preventDefault();
    spectator.toggleOverview();
  }
});
