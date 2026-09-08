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

  constructor(parent: HTMLElement, onStart: () => void) {
    this.root = document.createElement('div');
    this.root.className = 'screen';
    this.root.id = 'start-screen';
    this.root.innerHTML = `
      <div class="wordmark">BASH FIGHTER</div>
      <div class="subtitle">Local test build — two players, one keyboard or gamepads.</div>
      <div class="roster-label">CHOOSE YOUR FIGHTER (Player 1)</div>
      <div id="roster-mount"></div>
      <div class="select-row">
        <div class="select-card p1">
          <h3>PLAYER 1</h3>
          <pre class="bindings">${bindingLines(DEFAULT_P1_BINDING)}</pre>
        </div>
        <div class="select-card p2">
          <h3>PLAYER 2 (Placeholder)</h3>
          <pre class="bindings">${bindingLines(DEFAULT_P2_BINDING)}</pre>
        </div>
      </div>
      <button class="btn" id="start-btn">START MATCH</button>
      <div class="hint">Either player can plug in a gamepad to take over their slot. F3 toggles the debug overlay.</div>
    `;
    parent.appendChild(this.root);

    const rosterMount = this.root.querySelector('#roster-mount') as HTMLDivElement;
    this.characterSelect = new CharacterSelect(rosterMount, DEFAULT_CHARACTER_ID, () => {});

    (this.root.querySelector('#start-btn') as HTMLButtonElement).addEventListener('click', onStart);
  }

  /** Player 1's chosen character id, from @bash-fighter/content's roster.
   *  Player 2 (and any bot-filled slot) stays the default character --
   *  see main.ts's beginMatch for why that's the deliberately simple
   *  choice for this local 2-player test harness. */
  get selectedCharacterId(): string {
    return this.characterSelect.value;
  }

  show(): void {
    this.root.classList.remove('hidden');
  }

  hide(): void {
    this.root.classList.add('hidden');
  }
}
