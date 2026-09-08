// The interface the spectator system needs from the match/sim. Branch
// 19890 (packages/sim generalisation) is landing real eliminated /
// eliminationTick / placement / koCount fields and live shrinking arena
// bounds; until that's on main, StubMatchAdapter (stub-adapter.ts)
// approximates it from the fields the current 2-fighter sim already
// exposes (stocks). Swap the adapter's internals, not this interface,
// once the real fields land — nothing outside spectator/ should need to
// change.
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
