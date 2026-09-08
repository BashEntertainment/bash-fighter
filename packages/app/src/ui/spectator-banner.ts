// Small corner banner shown once the local player is eliminated: their
// placement, plus a one-line reminder of spectator controls. Deliberately
// not a full-screen takeover — the point is to keep watching, not to
// interrupt the match still in progress for everyone else.
function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

export class SpectatorBanner {
  readonly root: HTMLDivElement;
  private readonly placementLine: HTMLDivElement;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.id = 'spectator-banner';
    this.root.className = 'spectator-banner hidden';
    this.root.innerHTML = `
      <div class="placement-line"></div>
      <div class="hint">TAB cycle survivors · O overview</div>
    `;
    this.placementLine = this.root.querySelector('.placement-line') as HTMLDivElement;
    parent.appendChild(this.root);
  }

  show(placement: number, totalFighters: number): void {
    this.placementLine.textContent = `You finished ${ordinal(placement)} of ${totalFighters}`;
    this.root.classList.remove('hidden');
  }

  hide(): void {
    this.root.classList.add('hidden');
  }
}
