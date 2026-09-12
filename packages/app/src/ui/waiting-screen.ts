// The first thing a new player sees after clicking "Play online" and
// before their lobby fills: previously nothing but the game's canvas
// (plain black) with two small connection chips in the bottom-left
// corner -- no game name, no sense of what mode they're about to play,
// no idea what the controls even are. This gives that wait a deliberate,
// restrained composition instead: name, mode, how full the lobby is, and
// one line for a first-timer on how to play. It sits above the (still
// black) canvas and below the small connection chips, which keep their
// own always-on positions for every other connection state.
export class WaitingScreen {
  readonly root: HTMLDivElement;
  private readonly modeLine: HTMLDivElement;
  private readonly countLine: HTMLDivElement;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'waiting-screen hidden';
    this.root.id = 'waiting-screen';
    this.root.innerHTML = `
      <div class="waiting-wordmark">BASH FIGHTER</div>
      <div class="waiting-mode" id="waiting-mode"></div>
      <div class="waiting-count" id="waiting-count">Waiting for players&hellip;</div>
      <div class="waiting-hint">
        Move with A/D, jump with Space, attack with F, special with G, shield with LShift.
        Press M any time for the full move list.
      </div>
    `;
    parent.appendChild(this.root);
    this.modeLine = this.root.querySelector('#waiting-mode') as HTMLDivElement;
    this.countLine = this.root.querySelector('#waiting-count') as HTMLDivElement;
  }

  show(): void {
    this.root.classList.remove('hidden');
  }

  hide(): void {
    this.root.classList.add('hidden');
  }

  /** modeName is the same plain-language string the lobby chip already
   * shows (e.g. "Battle Royale — last fighter standing wins"). */
  setMode(modeName: string | undefined): void {
    this.modeLine.textContent = modeName ?? '';
    this.modeLine.classList.toggle('hidden', !modeName);
  }

  setCount(players: number, capacity: number, countdownTicks: number): void {
    const countdown = countdownTicks >= 0 ? ` — starting in ${Math.ceil(countdownTicks / 60)}s` : '';
    this.countLine.textContent = `${players} / ${capacity} players${countdown}`;
  }
}
