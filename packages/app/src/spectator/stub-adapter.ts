// STUB: approximates MatchAdapter from today's 2-fighter, stocks-based
// sim. Real per-fighter eliminated/eliminationTick/placement/koCount and
// live shrinking arena bounds are landing in packages/sim on branch
// 19890 (battle-royale generalisation) — once those fields exist on
// FighterSnapshot/Sim, replace the body of this file to read them
// directly instead of inferring "eliminated" from stocks reaching 0.
// Nothing else in the app should need to change; everything else talks
// to the MatchAdapter interface.
import type { FighterSnapshot } from '@bash-fighter/sim';
import type { Match } from '../match.ts';
import type { FighterMatchStatus, LiveArenaBounds, MatchAdapter } from './types.ts';

export class StubMatchAdapter implements MatchAdapter {
  readonly fighterCount: number;
  private readonly eliminatedAt: (number | null)[];
  private readonly placementOf: (number | null)[];
  private nextPlacementFromLast: number;

  constructor(private readonly match: Match) {
    const n = match.currentSnapshots().length;
    this.fighterCount = n;
    this.eliminatedAt = new Array(n).fill(null);
    this.placementOf = new Array(n).fill(null);
    // Placements are assigned from the back: the first fighter eliminated
    // gets the worst placement (n), the last one standing gets 1st.
    this.nextPlacementFromLast = n;
  }

  update(): void {
    const snaps = this.match.currentSnapshots();
    const tick = this.match.sim.getTick();
    for (let i = 0; i < snaps.length; i++) {
      const s = snaps[i] as FighterSnapshot;
      if (s.stocks <= 0 && this.eliminatedAt[i] === null) {
        this.eliminatedAt[i] = tick;
        this.placementOf[i] = this.nextPlacementFromLast;
        this.nextPlacementFromLast -= 1;
      }
    }
    // Once only one fighter has stocks left, they take 1st outright
    // (stub reproduces "last fighter standing" placement without
    // waiting on a real sim isMatchOver signal).
    const alive = this.survivorIndices();
    if (alive.length === 1 && this.placementOf[alive[0] as number] === null) {
      this.placementOf[alive[0] as number] = 1;
    }
  }

  status(index: number): FighterMatchStatus {
    return {
      eliminated: this.eliminatedAt[index] !== null,
      eliminationTick: this.eliminatedAt[index] ?? null,
      placement: this.placementOf[index] ?? null,
      koCount: 0, // not tracked by the current sim — stub until landed
    };
  }

  survivorIndices(): number[] {
    const out: number[] = [];
    for (let i = 0; i < this.fighterCount; i++) {
      if (this.eliminatedAt[i] === null) out.push(i);
    }
    return out;
  }

  liveArenaBounds(): LiveArenaBounds | null {
    return null; // arena shrink isn't implemented by the sim yet
  }

  isMatchOver(): boolean {
    return this.match.sim.isMatchOver();
  }
}
