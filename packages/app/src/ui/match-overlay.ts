// Full-screen overlay for the two moments a player must not be left
// guessing what happened or what to do next: elimination ("you're out,
// here's exactly what happens if you click") and a lost connection
// ("here's what happened, here's how to try again"). Replaces a silent
// black canvas or a small corner-chip-only state with something a
// first-time player can actually read and act on.
//
// Deliberately not a takeover of the whole page forever -- callers hide()
// it the moment the situation resolves (reconnected, new match joined).
export interface MatchOverlayAction {
  label: string;
  onClick: () => void;
  /** 'primary' (amber, the expected next click) or 'plain' (quiet text
   * link, an alternative). Defaults to 'primary'. */
  kind?: 'primary' | 'plain';
}

export interface MatchOverlayContent {
  /** Small label above the title, e.g. "ELIMINATED" or "CONNECTION LOST".
   * Kept short and plain -- not a decorative eyebrow, an actual status
   * word the player needs. */
  kicker?: string;
  title: string;
  message: string;
  actions: MatchOverlayAction[];
  /** 'default' | 'danger' -- danger tints the kicker/accent red for a
   * genuine failure (lost connection) vs the neutral/amber tone used for
   * a normal in-game event (elimination). */
  tone?: 'default' | 'danger';
}

/** Slot label for the winner line in announceWinner, matching the HUD's
 * own '#' + (slot + 1) convention (packages/app/src/ui/hud.ts). */
function slotLabel(slot: number): string {
  return `#${slot + 1}`;
}

/** Pure text logic for announceWinner, split out so it has regression
 * coverage without needing a DOM (see match-overlay.test.ts) -- this is
 * the part that was actually wrong (missing entirely) in the 2026-09-10
 * stranded-spectator bug, not the DOM plumbing around it. */
export function winnerAnnouncementLine(winnerSlot: number | null, localSlot: number | null | undefined): string {
  if (winnerSlot == null) return 'The match ended with no winner.';
  if (localSlot != null && localSlot === winnerSlot) return 'The match ended -- you won it!';
  return `The match ended -- ${slotLabel(winnerSlot)} won.`;
}

export class MatchOverlay {
  readonly root: HTMLDivElement;
  private readonly panel: HTMLDivElement;
  private readonly kickerEl: HTMLDivElement;
  private readonly titleEl: HTMLDivElement;
  private readonly messageEl: HTMLDivElement;
  private readonly actionsEl: HTMLDivElement;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.id = 'match-overlay';
    this.root.className = 'match-overlay hidden';
    this.root.innerHTML = `
      <div class="match-overlay-panel">
        <div class="match-overlay-kicker"></div>
        <div class="match-overlay-title"></div>
        <div class="match-overlay-message"></div>
        <div class="match-overlay-actions"></div>
      </div>
    `;
    this.panel = this.root.querySelector('.match-overlay-panel') as HTMLDivElement;
    this.kickerEl = this.root.querySelector('.match-overlay-kicker') as HTMLDivElement;
    this.titleEl = this.root.querySelector('.match-overlay-title') as HTMLDivElement;
    this.messageEl = this.root.querySelector('.match-overlay-message') as HTMLDivElement;
    this.actionsEl = this.root.querySelector('.match-overlay-actions') as HTMLDivElement;
    parent.appendChild(this.root);
  }

  show(content: MatchOverlayContent): void {
    this.kickerEl.textContent = content.kicker ?? '';
    this.kickerEl.classList.toggle('hidden', !content.kicker);
    this.titleEl.textContent = content.title;
    this.messageEl.textContent = content.message;
    this.panel.dataset.tone = content.tone ?? 'default';
    this.actionsEl.innerHTML = '';
    for (const action of content.actions) {
      const btn = document.createElement('button');
      btn.className = action.kind === 'plain' ? 'btn btn-plain' : 'btn btn-primary';
      btn.textContent = action.label;
      btn.addEventListener('click', action.onClick);
      this.actionsEl.appendChild(btn);
    }
    this.root.classList.remove('hidden');
  }

  hide(): void {
    this.root.classList.add('hidden');
  }

  /** 2026-09-10: a spectator who was already eliminated (their own
   * placement overlay from onEliminated) must still be told who won once
   * the match genuinely resolves -- "no terminal state may leave the
   * player with nothing to say happened" applies to them too, even if
   * they clicked "Keep spectating" and dismissed the overlay. Appends the
   * winner line to whatever message is already showing (or re-shows the
   * overlay with just the winner line if it had been dismissed) without
   * keeping their "Play again" action and dropping "Keep spectating",
   * which is meaningless once the match is over. Safe to call multiple times. */
  announceWinner(winnerSlot: number | null, localSlot: number | null | undefined): void {
    const already = this.messageEl.dataset.winnerAnnounced === String(winnerSlot);
    if (already) return;
    const line = winnerAnnouncementLine(winnerSlot, localSlot);
    this.messageEl.textContent = `${this.messageEl.textContent} ${line}`.trim();
    this.messageEl.dataset.winnerAnnounced = String(winnerSlot);
    // Once the match has genuinely ended there is nothing left to spectate,
    // so a "Keep spectating" action would dismiss the overlay into a frozen
    // final frame with no way back. Drop it and leave "Play again" alone.
    for (const btn of Array.from(this.actionsEl.querySelectorAll('button'))) {
      if (btn.textContent === 'Keep spectating') btn.remove();
    }
    this.root.classList.remove('hidden');
  }

  get isVisible(): boolean {
    return !this.root.classList.contains('hidden');
  }
}
