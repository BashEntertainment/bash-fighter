// In-match HUD: percent + stocks per fighter. Built as a data-driven list
// (not "left card / right card") so it degrades from two big readouts to a
// compact row/list as fighter count grows toward a 20-player FFA, without
// a structural rewrite — same markup, denser CSS class for N>4.
import { fixed as fx, FighterStateId, type FighterSnapshot } from '@bash-fighter/sim';
import { PALETTE } from '@bash-fighter/render';

const PLAYER_HEX = PALETTE.fighters.map((c) => `#${c.toString(16).padStart(6, '0')}`);

export class Hud {
  readonly root: HTMLDivElement;
  private readonly list: HTMLDivElement;
  private cards: HTMLDivElement[] = [];

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.id = 'hud';
    this.root.className = 'hidden';
    this.list = document.createElement('div');
    this.list.className = 'hud-list';
    this.root.appendChild(this.list);
    parent.appendChild(this.root);
  }

  show(): void {
    this.root.classList.remove('hidden');
  }

  hide(): void {
    this.root.classList.add('hidden');
  }

  private ensureCards(count: number): void {
    this.list.classList.toggle('compact', count > 4);
    while (this.cards.length < count) {
      const card = document.createElement('div');
      card.className = 'hud-card';
      card.innerHTML = '<div class="pct">0%</div><div class="stocks"></div>';
      this.cards.push(card);
      this.list.appendChild(card);
    }
    for (let i = count; i < this.cards.length; i++) {
      (this.cards[i] as HTMLDivElement).style.display = 'none';
    }
  }

  update(snapshots: readonly FighterSnapshot[]): void {
    this.ensureCards(snapshots.length);
    for (let i = 0; i < snapshots.length; i++) {
      const s = snapshots[i] as FighterSnapshot;
      const card = this.cards[i] as HTMLDivElement;
      card.style.display = '';
      card.style.borderLeftColor = PLAYER_HEX[i % PLAYER_HEX.length] as string;
      const pctEl = card.querySelector('.pct') as HTMLDivElement;
      const stocksEl = card.querySelector('.stocks') as HTMLDivElement;
      const pct = Math.round(fx.toFloat(s.percent));
      pctEl.textContent = `${pct}%`;
      pctEl.style.color = s.state === FighterStateId.DEAD ? '#666' : pct >= 100 ? PALETTE_DANGER_HEX : '';
      stocksEl.textContent = '●'.repeat(Math.max(0, s.stocks)) || '—';
    }
  }
}

const PALETTE_DANGER_HEX = `#${PALETTE.danger.toString(16).padStart(6, '0')}`;
