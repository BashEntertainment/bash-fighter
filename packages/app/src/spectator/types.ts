// The interface the spectator system needs from the match/sim.
// SimMatchAdapter (sim-adapter.ts) implements this directly off packages/sim's
// real eliminated / eliminationTick / placement / koCount fields and its
// live shrinking blast rect (both landed in commits 6b3db1e/0a33710).
export interface FighterMatchStatus {
  eliminated: boolean;
  eliminationTick: number | null;
  /** 1 = winner/last survivor. Filled in as fighters are eliminated;
   * null while still alive and the match isn't over. */
  placement: number | null;
  koCount: number;
}

export interface LiveArenaBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export interface MatchAdapter {
  readonly fighterCount: number;
  /** Call once per sim tick (or per render frame — it's idempotent
   * against ticks that already happened) so elimination bookkeeping
   * stays current. */
  update(): void;
  status(index: number): FighterMatchStatus;
  survivorIndices(): number[];
  /** Null when the arena isn't shrinking (not implemented by the current
   * sim yet) — callers fall back to the renderer's static stage bounds. */
  liveArenaBounds(): LiveArenaBounds | null;
  isMatchOver(): boolean;
}
