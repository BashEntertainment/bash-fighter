// Win screen: names the winner and offers one obvious way back into a
// match. Deliberately written in the same voice as the elimination
// overlay -- a player who has just lost and a player who has just won
// should not feel like they are looking at two different games.
import { PALETTE } from '@bash-fighter/render';

const PLAYER_HEX = PALETTE.playerColors.map((c) => `#${c.toString(16).padStart(6, '0')}`);

export class WinScreen {
  readonly root: HTMLDivElement;
  private readonly headline: HTMLDivElement;
  private readonly subtitle: HTMLDivElement;

  constructor(parent: HTMLElement, onRematch: () => void) {
    this.root = document.createElement('div');
    this.root.className = 'screen hidden';
    this.root.id = 'win-screen';
    this.root.innerHTML = `
      <div class="win-headline" id="win-headline">&mdash;</div>
      <div class="subtitle" id="win-subtitle">Match over.</div>
      <button class="btn btn-primary" id="rematch-btn">Play again</button>
    `;
    parent.appendChild(this.root);
    this.headline = this.root.querySelector('#win-headline') as HTMLDivElement;
    this.subtitle = this.root.querySelector('#win-subtitle') as HTMLDivElement;
    (this.root.querySelector('#rematch-btn') as HTMLButtonElement).addEventListener('click', onRematch);
  }

  /**
   * @param winnerIndex slot of the winning fighter, or null when the match
   *   ended with no survivor (a simultaneous double knockout).
   * @param localSlot the slot this client was playing, when known, so the
   *   winner is told they won rather than reading their own slot number.
   */
  show(winnerIndex: number | null, localSlot?: number, nameFor?: (slot: number) => string): void {
    if (winnerIndex === null) {
      this.headline.textContent = 'Nobody survived';
      this.headline.style.color = '';
      this.headline.style.borderBottomColor = '#666';
      this.subtitle.textContent = 'Everyone went out on the same frame.';
    } else {
      const won = localSlot !== undefined && localSlot >= 0 && localSlot === winnerIndex;
      const colour = PLAYER_HEX[winnerIndex % PLAYER_HEX.length] as string;
      const label = nameFor ? nameFor(winnerIndex) : `Fighter ${winnerIndex + 1}`;
      // The winner's colour identifies them, but at headline size a whole
      // sentence in one fighter's hue reads as decoration and fails contrast
      // for the darker slots. Same rule as the Timed Brawl standings: the
      // colour is a small marker, the words stay neutral.
      this.headline.textContent = '';
      const dot = document.createElement('span');
      dot.className = 'winner-dot';
      dot.style.background = colour;
      this.headline.appendChild(dot);
      this.headline.appendChild(document.createTextNode(won ? 'You win' : `${label} won`));
      this.headline.style.color = '';
      this.headline.style.borderBottomColor = colour;
      this.subtitle.textContent = won
        ? 'Last one standing out of twenty.'
        : 'Last one standing. Another match starts as soon as you are ready.';
    }
    this.root.classList.remove('hidden');
  }

  hide(): void {
    this.root.classList.add('hidden');
  }
}
