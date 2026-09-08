// Character-select grid: one card per entry in @bash-fighter/content's
// roster. Deliberately generic -- it iterates ALL_CHARACTERS rather than
// switching on known ids, so a third character becomes selectable the
// moment it's added to that package's roster, with no change here.
import { ALL_CHARACTERS } from '@bash-fighter/content';

// Deterministic per-id color instead of a per-character asset: keeps this
// screen from needing to know how to draw any given character's shape,
// which is a rendering concern that already lives in packages/render's
// fighter-sprite dispatch (by character name) for the actual match.
const SWATCH_PALETTE = ['#e8b23c', '#4fa3c4', '#8a5fd1', '#5fd18a', '#d75f8a', '#d7593f', '#3fbfa0'];

function colorForId(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return SWATCH_PALETTE[h % SWATCH_PALETTE.length] as string;
}

export class CharacterSelect {
  readonly root: HTMLDivElement;
  private selectedId: string;
  private readonly cards = new Map<string, HTMLButtonElement>();

  constructor(parent: HTMLElement, defaultId: string, onChange: (id: string) => void) {
    this.root = document.createElement('div');
    this.root.className = 'roster-row';
    this.root.id = 'character-select';

    for (const entry of ALL_CHARACTERS) {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'roster-card';
      card.dataset.characterId = entry.id;

      const swatch = document.createElement('div');
      swatch.className = 'roster-swatch';
      swatch.style.background = colorForId(entry.id);
      swatch.textContent = entry.character.name.charAt(0).toUpperCase();

      const name = document.createElement('div');
      name.className = 'roster-name';
      name.textContent = entry.character.name;

      const weight = document.createElement('div');
      weight.className = 'roster-weight';
      weight.textContent = `weight ${Math.round(entry.character.weight / 65536)}`;

      card.append(swatch, name, weight);
      card.addEventListener('click', () => this.select(entry.id, onChange));
      this.cards.set(entry.id, card);
      this.root.appendChild(card);
    }

    parent.appendChild(this.root);
    // Fall back to the first roster entry if defaultId isn't known (e.g.
    // roster changed), so there is always a valid selection to start with.
    const initial = this.cards.has(defaultId) ? defaultId : (ALL_CHARACTERS[0]?.id ?? defaultId);
    this.selectedId = initial;
    this.applySelectionStyles();
  }

  private select(id: string, onChange: (id: string) => void): void {
    if (id === this.selectedId) return;
    this.selectedId = id;
    this.applySelectionStyles();
    onChange(id);
  }

  private applySelectionStyles(): void {
    for (const [cid, card] of this.cards) card.classList.toggle('selected', cid === this.selectedId);
  }

  get value(): string {
    return this.selectedId;
  }
}
