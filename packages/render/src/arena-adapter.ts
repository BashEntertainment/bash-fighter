// The one place that turns a sim ArenaData (fixed-point, authoritative)
// into the renderer's StageBounds (plain floats). Both the local match
// (packages/app/src/match.ts) and the online match
// (packages/app/src/net-match.ts) must feed the renderer the arena the
// sim is actually simulating -- see createMatchSim in
// packages/content/src/match-sim.ts, whose comment explains why a
// mismatched arena is the worst bug class in this codebase. Routing both
// call sites through this single converter makes it structurally hard to
// feed the renderer a different arena than the one the Sim was built
// with.
import { fixed as fx, type ArenaData } from '@bash-fighter/sim';
import type { StageBounds } from './stage.ts';

export function arenaDataToStageBounds(arena: ArenaData): StageBounds {
  return {
    platforms: arena.platforms.map((p) => ({
      minX: fx.toFloat(p.minX),
      maxX: fx.toFloat(p.maxX),
      y: fx.toFloat(p.y),
    })),
    blastMinX: fx.toFloat(arena.blastMinX),
    blastMaxX: fx.toFloat(arena.blastMaxX),
    blastMinY: fx.toFloat(arena.blastMinY),
    blastMaxY: fx.toFloat(arena.blastMaxY),
    // Cosmetic only -- see ArenaData.accentColor's comment. Sim state
    // never depends on this.
    accentColor: arena.accentColor,
  };
}
