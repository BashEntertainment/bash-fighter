// Start / character-select screen: confirm local key bindings, pick a
// character from the roster, then start a local match. The roster grid
// (CharacterSelect) reads the character list from @bash-fighter/content,
// so adding a third character never requires touching this file.
import { DEFAULT_P1_BINDING, DEFAULT_P2_BINDING, type KeyBinding } from '@bash-fighter/input';
import { DEFAULT_CHARACTER_ID } from '@bash-fighter/content';
import { CharacterSelect } from './character-select.ts';

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
  private readonly characterSelect: CharacterSelect;
  private readonly p1BindingsEl: HTMLPreElement;
  private readonly p2BindingsEl: HTMLPreElement;

  constructor(parent: HTMLElement, onStart: () => void, onWatchReplay?: () => void) {
    this.root = document.createElement('div');
    this.root.className = 'screen';
    this.root.id = 'start-screen';
    this.root.innerHTML = `
      <div class="wordmark">BASH FIGHTER</div>
      <div class="subtitle">Twenty fighters, a different arena every match, last one standing. Free and open source, plays in your browser.</div>
      <div class="roster-label">Choose your fighter</div>
      <div id="roster-mount"></div>
      <div id="primary-actions"></div>
      <div class="hint">The arena shrinks as fighters are eliminated. Empty slots are filled by bots so a match always starts.</div>
      <button class="btn btn-secondary" id="watch-replay-btn">Watch a replay</button>
      <details class="local-play">
        <summary>Play locally on one keyboard</summary>
        <div class="select-row">
          <div class="select-card p1">
            <h3>Player 1</h3>
            <pre class="bindings p1-bindings">${bindingLines(DEFAULT_P1_BINDING)}</pre>
          </div>
          <div class="select-card p2">
            <h3>Player 2</h3>
            <pre class="bindings p2-bindings">${bindingLines(DEFAULT_P2_BINDING)}</pre>
          </div>
        </div>
        <button class="btn btn-secondary" id="start-btn">Start local match</button>
        <div class="hint">Either player can plug in a gamepad to take over their slot. F3 toggles the debug overlay.</div>
      </details>
    `;
    parent.appendChild(this.root);

    this.p1BindingsEl = this.root.querySelector('.p1-bindings') as HTMLPreElement;
    this.p2BindingsEl = this.root.querySelector('.p2-bindings') as HTMLPreElement;

    const rosterMount = this.root.querySelector('#roster-mount') as HTMLDivElement;
    this.characterSelect = new CharacterSelect(rosterMount, DEFAULT_CHARACTER_ID, () => {});

    (this.root.querySelector('#start-btn') as HTMLButtonElement).addEventListener('click', onStart);
    if (onWatchReplay) {
      (this.root.querySelector('#watch-replay-btn') as HTMLButtonElement).addEventListener('click', onWatchReplay);
    }
  }

  /** Player 1's chosen character id, from @bash-fighter/content's roster.
   *  Player 2 (and any bot-filled slot) stays the default character --
   *  see main.ts's beginMatch for why that's the deliberately simple
   *  choice for this local 2-player test harness. */
  get selectedCharacterId(): string {
    return this.characterSelect.value;
  }

  /** Called by main.ts whenever the player's remapped bindings change, so
   * the "Play locally" hint text stays in sync with reality instead of
   * always showing the hardcoded defaults after a rebind. */
  updateBindings(p1: KeyBinding, p2: KeyBinding): void {
    this.p1BindingsEl.textContent = bindingLines(p1);
    this.p2BindingsEl.textContent = bindingLines(p2);
  }

  show(): void {
    this.root.classList.remove('hidden');
  }

  hide(): void {
    this.root.classList.add('hidden');
  }
}
