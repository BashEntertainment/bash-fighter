// In-game move reference (repo issue #5): nobody was told how to fight.
// Openable from the start/character-select screen and, without ending
// the match, from inside one. Descriptions come from
// move-reference-data.ts, derived from the roster's own frame numbers --
// see that file for why.
import { ALL_CHARACTERS } from '@bash-fighter/content';
import { moveReferenceFor } from '../move-reference-data.ts';

export class MoveReferencePanel {
  readonly root: HTMLDivElement;
  private readonly titleEl: HTMLDivElement;
  private readonly tabsEl: HTMLDivElement;
  private readonly listEl: HTMLDivElement;
  private selectedIndex = 0;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.id = 'move-reference-panel';
    this.root.className = 'move-reference-panel hidden';
    this.root.innerHTML = `
      <div class="move-reference-inner">
        <div class="move-reference-header">
          <div class="move-reference-title">Move reference</div>
          <button type="button" class="move-reference-close" aria-label="Close">Close</button>
        </div>
        <div class="move-reference-tabs"></div>
        <div class="move-reference-list"></div>
      </div>
    `;
    this.titleEl = this.root.querySelector('.move-reference-title') as HTMLDivElement;
    this.tabsEl = this.root.querySelector('.move-reference-tabs') as HTMLDivElement;
    this.listEl = this.root.querySelector('.move-reference-list') as HTMLDivElement;
    (this.root.querySelector('.move-reference-close') as HTMLButtonElement).addEventListener('click', () =>
      this.hide(),
    );
    this.root.addEventListener('click', (e) => {
      if (e.target === this.root) this.hide();
    });
    ALL_CHARACTERS.forEach((entry, i) => {
      const tab = document.createElement('button');
      tab.type = 'button';
      tab.className = 'move-reference-tab';
      tab.textContent = entry.character.name;
      tab.addEventListener('click', () => this.select(i));
      this.tabsEl.appendChild(tab);
    });
    parent.appendChild(this.root);
  }

  /** Open focused on a specific character -- used from character select,
   * where the player already has one highlighted and the panel should
   * answer "what does *this* one do" without extra clicks. */
  show(characterId?: string): void {
    const idx = characterId ? ALL_CHARACTERS.findIndex((c) => c.id === characterId) : -1;
    this.select(idx >= 0 ? idx : this.selectedIndex);
    this.root.classList.remove('hidden');
  }

  hide(): void {
    this.root.classList.add('hidden');
  }

  get isOpen(): boolean {
    return !this.root.classList.contains('hidden');
  }

  private select(index: number): void {
    this.selectedIndex = index;
    const entry = ALL_CHARACTERS[index];
    if (!entry) return;
    this.titleEl.textContent = `Move reference — ${entry.character.name}`;
    Array.from(this.tabsEl.children).forEach((el, i) => el.classList.toggle('active', i === index));
    const moves = moveReferenceFor(entry.character);
    this.listEl.innerHTML = '';
    for (const move of moves) {
      const row = document.createElement('div');
      row.className = 'move-reference-row';
      row.innerHTML = `
        <div class="move-reference-name">${move.name}</div>
        <div class="move-reference-input">${move.input}</div>
        <div class="move-reference-desc">${move.description}</div>
      `;
      this.listEl.appendChild(row);
    }
  }
}
