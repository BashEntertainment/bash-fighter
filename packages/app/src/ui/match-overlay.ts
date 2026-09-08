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

  get isVisible(): boolean {
    return !this.root.classList.contains('hidden');
  }
}
