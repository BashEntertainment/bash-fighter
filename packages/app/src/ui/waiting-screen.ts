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

  constructor(parent: HTMLElement, touchCapable: boolean) {
    this.root = document.createElement('div');
    this.root.className = 'waiting-screen hidden';
    this.root.id = 'waiting-screen';
    // Found in the phone-width pass, 2026-09-12: this line always read
    // the keyboard bindings ("Move with A/D...") even when forceTouch (or
    // a real touch device) meant the player has no keyboard at all and
    // will only ever see the on-screen stick/buttons -- instructions for
    // controls that cannot be pressed. Same touchCapable check main.ts
    // already uses to decide whether to show TouchControls at all.
    const hint = touchCapable
      ? 'Move with the on-screen stick, attack, special and shield with the buttons beside it.'
      : 'Move with A/D, jump with Space, attack with F, special with G, shield with LShift. Press M any time for the full move list.';
    this.root.innerHTML = `
      <div class="waiting-wordmark">BASH FIGHTER</div>
      <div class="waiting-mode" id="waiting-mode"></div>
      <div class="waiting-count" id="waiting-count">Waiting for players&hellip;</div>
      <div class="waiting-hint" id="waiting-hint"></div>
    `;
    parent.appendChild(this.root);
    this.modeLine = this.root.querySelector('#waiting-mode') as HTMLDivElement;
    this.countLine = this.root.querySelector('#waiting-count') as HTMLDivElement;
    // textContent, not innerHTML -- consistent with every other
    // player-facing string in this file even though this one is static.
    (this.root.querySelector('#waiting-hint') as HTMLDivElement).textContent = hint;
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
