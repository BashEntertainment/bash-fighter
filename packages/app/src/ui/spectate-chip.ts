/**
 * A small, always-reachable "Play again" control for a player who chose to
 * keep watching after their own elimination.
 *
 * Why this exists (2026-09-12): the spectate escape hatch used to force the
 * player's whole placement overlay back on screen every 25 seconds while the
 * match was still running. A player who had explicitly asked to keep watching
 * therefore had a panel thrown over the fight again and again, and a click
 * aimed at the game could land on a button that had just reappeared. The
 * escape hatch is still guaranteed, but it is now this chip: unobtrusive,
 * permanent, and never covering the action.
 */
export class SpectateChip {
  private readonly root: HTMLDivElement;

  constructor(parent: HTMLElement, onPlayAgain: () => void) {
    this.root = document.createElement('div');
    this.root.className = 'spectate-chip hidden';
    const btn = document.createElement('button');
    btn.className = 'btn btn-plain';
    btn.textContent = 'Play again';
    btn.addEventListener('click', onPlayAgain);
    this.root.appendChild(btn);
    parent.appendChild(this.root);
  }

  get isVisible(): boolean {
    return !this.root.classList.contains('hidden');
  }

  show(): void {
    this.root.classList.remove('hidden');
  }

  hide(): void {
    this.root.classList.add('hidden');
  }
}
