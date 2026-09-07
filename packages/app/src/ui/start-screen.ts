// Start / character-select screen. Only one placeholder character exists
// for this milestone, so "select" is really "confirm bindings and go" —
// still structured as its own screen per the spec, ready to grow into a
// real roster grid later.
import { DEFAULT_P1_BINDING, DEFAULT_P2_BINDING, type KeyBinding } from '@bash-fighter/input';

function bindingLines(b: KeyBinding): string {
  return [
    `move  ${b.left}/${b.right}/${b.up}/${b.down}`,
    `jump  ${b.jump}`,
    `attack  ${b.attack}`,
    `special  ${b.special}`,
    `shield  ${b.shield}`,
  ].join('\n');
}

export class StartScreen {
  readonly root: HTMLDivElement;

  constructor(parent: HTMLElement, onStart: () => void) {
    this.root = document.createElement('div');
    this.root.className = 'screen';
    this.root.id = 'start-screen';
    this.root.innerHTML = `
      <div class="title">BASH ENTERTAINMENT — LOCAL MATCH</div>
      <div class="wordmark">BASH FIGHTER</div>
      <div class="select-row">
        <div class="select-card p1">
          <h3>PLAYER 1</h3>
          <div class="name">Placeholder</div>
          <pre class="bindings">${bindingLines(DEFAULT_P1_BINDING)}</pre>
        </div>
        <div class="select-card p2">
          <h3>PLAYER 2</h3>
          <div class="name">Placeholder</div>
          <pre class="bindings">${bindingLines(DEFAULT_P2_BINDING)}</pre>
        </div>
      </div>
      <button class="btn" id="start-btn">START MATCH</button>
      <div class="hint">Either player can plug in a gamepad to take over their slot. F3 toggles the debug overlay.</div>
    `;
    parent.appendChild(this.root);
    (this.root.querySelector('#start-btn') as HTMLButtonElement).addEventListener('click', onStart);
  }

  show(): void {
    this.root.classList.remove('hidden');
  }

  hide(): void {
    this.root.classList.add('hidden');
  }
}
