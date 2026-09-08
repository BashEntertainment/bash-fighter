import './style.css';
import { Match, STAGE_BOUNDS } from './match.ts';
import { StartScreen } from './ui/start-screen.ts';
import { WinScreen } from './ui/win-screen.ts';
import { Hud } from './ui/hud.ts';
import { SpectatorBanner } from './ui/spectator-banner.ts';
import { SimMatchAdapter } from './spectator/sim-adapter.ts';
import { SpectatorController } from './spectator/controller.ts';
import { NetMatch, type ConnectionState } from './net-match.ts';
import { PLACEHOLDER_CHARACTER, resolveCharacterId } from '@bash-fighter/content';
import type { ArenaBounds } from '@bash-fighter/render';
import { AudioManager } from '@bash-fighter/audio';

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
let adapter: SimMatchAdapter | null = null;
let spectator: SpectatorController | null = null;
let matchGeneration = 0;
let lastFrameTimeMs: number | null = null;

// One AudioManager for the whole app -- both local Match and NetMatch
// play through it, so the mute control and voice cap are global rather
// than per-match. Initialized lazily on the first user gesture anywhere
// on the page (autoplay policy); safe to call init multiple times.
const audio = new AudioManager();
window.addEventListener(
  'pointerdown',
  () => {
    audio.initOnGesture();
    audio.startAmbient();
  },
  { once: true },
);

const muteButton = document.createElement('button');
muteButton.id = 'mute-btn';
muteButton.className = 'mute-btn';
function refreshMuteLabel(): void {
  muteButton.textContent = audio.isMuted ? 'SOUND OFF' : 'SOUND ON';
  muteButton.dataset.muted = String(audio.isMuted);
}
refreshMuteLabel();
muteButton.addEventListener('click', () => {
  audio.initOnGesture();
  audio.toggleMuted();
  refreshMuteLabel();
});
appRoot.appendChild(muteButton);

const hud = new Hud(appRoot);
const spectatorBanner = new SpectatorBanner(appRoot);

const startScreen = new StartScreen(appRoot, () => {
  void beginMatch();
});

// Online mode is additive: a second button on the same start screen, and a
// small always-visible status line so connection state is never a silent
// blank screen. Local-match mode above is untouched and remains the
// offline/dev test harness.
const netStatus = document.createElement('div');
netStatus.id = 'net-status';
netStatus.className = 'hidden';
appRoot.appendChild(netStatus);

function setNetStatus(state: ConnectionState, detail?: string): void {
  netStatus.classList.remove('hidden');
  const label: Record<ConnectionState, string> = {
    connecting: 'Connecting…',
    waiting: 'Waiting for players…',
    'in-match': 'In match',
    spectating: 'Spectating',
    disconnected: 'Disconnected',
    reconnecting: 'Reconnecting…',
    error: 'Connection error',
  };
  netStatus.textContent = detail ? `${label[state]} — ${detail}` : label[state];
  netStatus.dataset.state = state;
}

const onlineButton = document.createElement('button');
onlineButton.className = 'btn';
onlineButton.id = 'online-btn';
onlineButton.textContent = 'PLAY ONLINE';
startScreen.root.appendChild(onlineButton);
onlineButton.addEventListener('click', () => {
  void beginOnlineMatch();
});

let netMatch: NetMatch | null = null;

function serverUrl(): string {
  const params = new URLSearchParams(location.search);
  if (params.get('server')) return params.get('server') as string;
  // Same-origin by default: the vite dev server (and the exposed preview
  // tunnel) proxies /socket to the match server, so this works without a
  // second exposed port. Production build's static host will need the
  // same proxy rule (or a direct wss:// URL) — see docs/PROTOCOL.md.
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}/socket`;
}

async function beginOnlineMatch(): Promise<void> {
  startScreen.hide();
  winScreen.hide();
  spectatorBanner.hide();
  hud.hide();
  const generation = ++matchGeneration;

  if (match) {
    match.stop();
    match.renderer.destroy();
    match = null;
  }
  if (netMatch) {
    netMatch.stop();
    netMatch.renderer.destroy();
    netMatch = null;
  }
  canvasRoot.innerHTML = '';

  const name = `Fighter${Math.floor(Math.random() * 1000)}`;
  const characterId = startScreen.selectedCharacterId;
  const net = new NetMatch(serverUrl(), {
    onStateChange: (state, detail) => setNetStatus(state, detail),
    onLobby: (players, capacity, countdownTicks) => {
      const countdown = countdownTicks >= 0 ? ` — starting in ${Math.ceil(countdownTicks / 60)}s` : '';
      setNetStatus('waiting', `${players}/${capacity} players${countdown}`);
    },
    onMatchOver: (winnerIndex) => {
      hud.hide();
      audio.play('match_end');
      winScreen.show(winnerIndex);
    },
  }, audio);
  netMatch = net;
  await net.init(canvasRoot);
  net.connect(name, characterId);

  // Same HUD widget the local match uses (packages/app/src/ui/hud.ts),
  // fed from NetMatch.currentSnapshots() -- see that method's comment for
  // why it is a safe drop-in for Match.currentSnapshots(). Shown once a
  // match has actually started so it never shows fighter cards over the
  // waiting-for-players screen.
  let announcedStart = false;
  const onlineHudTick = (): void => {
    if (generation !== matchGeneration) return;
    if (netMatch && netMatch.hasStarted()) {
      if (!announcedStart) {
        announcedStart = true;
        audio.play('match_start');
      }
      hud.show();
      hud.update(netMatch.currentSnapshots());
    } else {
      hud.hide();
    }
    requestAnimationFrame(onlineHudTick);
  };
  requestAnimationFrame(onlineHudTick);
}

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

  audio.play('match_start');
  // Player 1 (the local slot) gets the chosen character; slot 1 stays the
  // default placeholder -- this local harness is 2 human-controlled slots,
  // not bot-filled, so there is no bot roster to randomize here.
  const localCharacters = [resolveCharacterId(startScreen.selectedCharacterId), PLACEHOLDER_CHARACTER];
  const localMatch: Match = new Match(canvasRoot, localCharacters, Date.now() & 0xffffffff, {
    onMatchOver: (winnerIndex) => {
      hud.hide();
      audio.play('match_end');
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
  }, undefined, audio);
  match = localMatch;
  adapter = new SimMatchAdapter(localMatch);
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
        const status = (adapter as SimMatchAdapter).status(i);
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
    netMatch?.toggleDebug();
  } else if (e.code === 'Tab' && spectator?.isActive) {
    e.preventDefault();
    spectator.cycleNext();
  } else if (e.code === 'KeyO' && spectator?.isActive) {
    e.preventDefault();
    spectator.toggleOverview();
  }
});
