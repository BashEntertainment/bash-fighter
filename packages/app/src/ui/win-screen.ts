// Win screen: names the winner (or a draw on simultaneous double-KO) with
// a rematch option that resets the match in place.
import { PALETTE } from '@bash-fighter/render';

const PLAYER_HEX = PALETTE.playerColors.map((c) => `#${c.toString(16).padStart(6, '0')}`);

export class WinScreen {
  readonly root: HTMLDivElement;
  private readonly headline: HTMLDivElement;

  constructor(parent: HTMLElement, onRematch: () => void) {
    this.root = document.createElement('div');
    this.root.className = 'screen hidden';
    this.root.id = 'win-screen';
    this.root.innerHTML = `
      <div class="wordmark" id="win-headline">—</div>
      <div class="subtitle">Match over.</div>
      <button class="btn" id="rematch-btn">REMATCH</button>
    `;
    parent.appendChild(this.root);
    this.headline = this.root.querySelector('#win-headline') as HTMLDivElement;
    (this.root.querySelector('#rematch-btn') as HTMLButtonElement).addEventListener('click', onRematch);
  }

  show(winnerIndex: number | null): void {
    if (winnerIndex === null) {
      this.headline.textContent = 'DOUBLE KO';
      this.headline.style.color = '';
      this.headline.style.borderBottomColor = '#666';
    } else {
      this.headline.textContent = `PLAYER ${winnerIndex + 1} WINS`;
      this.headline.style.color = PLAYER_HEX[winnerIndex % PLAYER_HEX.length] as string;
      this.headline.style.borderBottomColor = PLAYER_HEX[winnerIndex % PLAYER_HEX.length] as string;
    }
    this.root.classList.remove('hidden');
  }

  hide(): void {
    this.root.classList.add('hidden');
  }
}
