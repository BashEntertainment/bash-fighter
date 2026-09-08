// Real MatchAdapter backed directly by packages/sim's N-fighter fields.
// Replaces StubMatchAdapter (stub-adapter.ts, now unused/deleted) now that
// eliminated/eliminatedTick/placement/koCount and a live shrinking blast
// rect are real Sim state (commits 6b3db1e, 0a33710) rather than being
// inferred from stocks. Zero bookkeeping of its own: every call reads the
// sim's authoritative state fresh, so it can never drift from it.
import type { Match } from '../match.ts';
import type { FighterMatchStatus, LiveArenaBounds, MatchAdapter } from './types.ts';
import { fixed as fx } from '@bash-fighter/sim';

export class SimMatchAdapter implements MatchAdapter {
  readonly fighterCount: number;
  private readonly match: Match;

  constructor(match: Match) {
    this.match = match;
    this.fighterCount = match.currentSnapshots().length;
  }

  // No cross-tick bookkeeping needed: the sim already carries eliminated /
  // eliminatedTick / placement / koCount as real per-tick state.
  update(): void {}

  status(index: number): FighterMatchStatus {
    const s = this.match.sim.getFighter(index);
    return {
      eliminated: s.eliminated,
      eliminationTick: s.eliminated ? s.eliminatedTick : null,
      placement: s.placement > 0 ? s.placement : null,
      koCount: s.koCount,
    };
  }

  survivorIndices(): number[] {
    const out: number[] = [];
    for (let i = 0; i < this.fighterCount; i++) {
      if (!this.match.sim.getFighter(i).eliminated) out.push(i);
    }
    return out;
  }

  liveArenaBounds(): LiveArenaBounds | null {
    const rect = this.match.sim.getCurrentBlastRect();
    return {
      minX: fx.toFloat(rect.minX),
      maxX: fx.toFloat(rect.maxX),
      minY: fx.toFloat(rect.minY),
      maxY: fx.toFloat(rect.maxY),
    };
  }

  isMatchOver(): boolean {
    return this.match.sim.isMatchOver();
  }
}
