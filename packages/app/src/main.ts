import './style.css';
import { Match } from './match.ts';
import { StartScreen } from './ui/start-screen.ts';
import { WinScreen } from './ui/win-screen.ts';
import { Hud } from './ui/hud.ts';

const appRoot = document.getElementById('app') as HTMLDivElement;

const canvasRoot = document.createElement('div');
canvasRoot.id = 'canvas-root';
appRoot.appendChild(canvasRoot);

const debugHint = document.createElement('div');
debugHint.className = 'debug-hint';
debugHint.textContent = 'F3: debug overlay';
appRoot.appendChild(debugHint);

let match: Match | null = null;
let matchGeneration = 0;
const hud = new Hud(appRoot);

const startScreen = new StartScreen(appRoot, () => {
  void beginMatch();
});

const winScreen = new WinScreen(appRoot, () => {
  void beginMatch();
});

async function beginMatch(): Promise<void> {
  winScreen.hide();
  startScreen.hide();
  hud.show();
  const generation = ++matchGeneration;

  if (match) {
    match.stop();
    match.renderer.destroy();
    canvasRoot.innerHTML = '';
  }

  match = new Match(canvasRoot, undefined, Date.now() & 0xffffffff, {
    onMatchOver: (winnerIndex) => {
      hud.hide();
      winScreen.show(winnerIndex);
      match?.stop();
    },
  });
  await match.init(canvasRoot);
  match.start();

  const hudTick = (): void => {
    if (generation !== matchGeneration) return;
    if (match) hud.update(match.currentSnapshots());
    requestAnimationFrame(hudTick);
  };
  requestAnimationFrame(hudTick);
}

window.addEventListener('keydown', (e) => {
  if (e.code === 'F3') {
    e.preventDefault();
    match?.toggleDebug();
  }
});
