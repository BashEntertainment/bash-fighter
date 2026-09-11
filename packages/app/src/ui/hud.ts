// In-match HUD: percent + stocks per fighter, plus a survivors-remaining
// count once fighters start getting eliminated. Built as a data-driven
// list (not "left card / right card") so it degrades from two big
// readouts to a compact row/list as fighter count grows toward a
// 20-player FFA, without a structural rewrite — same markup, denser CSS
// class for N>4. Eliminated status is optional per-card input, sourced
// from spectator/types.ts's MatchAdapter once wired up.
import { fixed as fx, FighterStateId, type FighterSnapshot } from '@bash-fighter/sim';
import { PALETTE } from '@bash-fighter/render';

export interface HudFighterExtra {
  eliminated: boolean;
  placement: number | null;
}

const PLAYER_HEX = PALETTE.playerColors.map((c) => `#${c.toString(16).padStart(6, '0')}`);

export class Hud {
  readonly root: HTMLDivElement;
  private readonly list: HTMLDivElement;
  private cards: HTMLDivElement[] = [];

  private readonly survivorsLine: HTMLDivElement;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.id = 'hud';
    this.root.className = 'hidden';
    this.survivorsLine = document.createElement('div');
    this.survivorsLine.className = 'survivors-line';
    this.list = document.createElement('div');
    this.list.className = 'hud-list';
    this.root.appendChild(this.survivorsLine);
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
    // Two density steps: 'compact' once two big readouts stop fitting,
    // 'dense' once even compact cards would wrap into a screen-covering
    // block at 20-fighter counts -- same markup, just a third, tighter
    // CSS density instead of a different widget, so a 20p match still
    // reads as a HUD, not a page of debug text.
    this.list.classList.toggle('compact', count > 4 && count <= 10);
    this.list.classList.toggle('dense', count > 10);
    while (this.cards.length < count) {
      const card = document.createElement('div');
      card.className = 'hud-card';
      card.innerHTML = '<div class="slot-num"></div><div class="fighter-name"></div><div class="pct">0%</div><div class="stocks"></div>';
      this.cards.push(card);
      this.list.appendChild(card);
    }
    for (let i = count; i < this.cards.length; i++) {
      (this.cards[i] as HTMLDivElement).style.display = 'none';
    }
  }

  update(
    snapshots: readonly FighterSnapshot[],
    extras?: readonly HudFighterExtra[],
    localIndex = -1,
    names?: readonly string[],
  ): void {
    this.ensureCards(snapshots.length);
    let survivors = 0;
    for (let i = 0; i < snapshots.length; i++) {
      const s = snapshots[i] as FighterSnapshot;
      // extras (spectator-derived elimination status, local-only) take
      // priority when given; online matches have no extras so fall back
      // to the snapshot's own eliminated/placement fields, which the sim
      // fills in directly (see FighterSnapshot in packages/sim/src/sim.ts).
      const extra = extras?.[i];
      const eliminated = extra?.eliminated ?? s.eliminated;
      const placement = extra?.placement ?? (s.placement > 0 ? s.placement : null);
      if (!eliminated) survivors++;
      const card = this.cards[i] as HTMLDivElement;
      card.style.display = '';
      card.classList.toggle('eliminated', eliminated);
      card.classList.toggle('is-you', i === localIndex);
      card.style.borderLeftColor = PLAYER_HEX[i % PLAYER_HEX.length] as string;
      const pctEl = card.querySelector('.pct') as HTMLDivElement;
      const stocksEl = card.querySelector('.stocks') as HTMLDivElement;
      const numEl = card.querySelector('.slot-num') as HTMLDivElement;
      const nameEl = card.querySelector('.fighter-name') as HTMLDivElement;
      numEl.textContent = '#' + String(i + 1);
      // Slot number stays visible unconditionally (existing debug tooling,
      // the journal, and the elimination log are all slot-indexed -- see
      // docs/PROTOCOL.md), the chosen display name (if any) is shown
      // alongside it via textContent only, never innerHTML, so a hostile
      // name is always plain text here regardless of what the server
      // already stripped. names[] and '#N' fallback come from
      // NetMatch.nameFor()/Match's slot labels -- this component just
      // renders whatever it's given.
      const name = names?.[i];
      nameEl.textContent = name && name.length > 0 ? name : '';
      nameEl.style.display = nameEl.textContent ? '' : 'none';
      const pct = Math.round(fx.toFloat(s.percent));
      pctEl.textContent = `${pct}%`;
      pctEl.style.color = s.state === FighterStateId.DEAD ? '#666' : pct >= 100 ? PALETTE_DANGER_HEX : '';
      if (eliminated) {
        stocksEl.textContent = placement ? `OUT · ${placement}` : 'OUT';
      } else {
        stocksEl.textContent = '●'.repeat(Math.max(0, s.stocks)) || '—';
      }
    }
    this.survivorsLine.textContent = snapshots.length > 2 ? `${survivors} / ${snapshots.length} remaining` : '';
    this.survivorsLine.style.display = this.survivorsLine.textContent ? '' : 'none';
  }
}

const PALETTE_DANGER_HEX = `#${PALETTE.danger.toString(16).padStart(6, '0')}`;
