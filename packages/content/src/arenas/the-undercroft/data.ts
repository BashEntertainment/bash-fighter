// The Undercroft: a flat, wide brawl stage with a real floor you can fall
// through. Two long ground slabs flank a central chasm with no floor at
// y=0; the only way across at ground level is around the ends, or over the
// top via a single high bridge platform. This is deliberately NOT a
// rearrangement of Bash Colosseum's platform ring -- there is no vertical
// tower here, just "can you keep your footing on open ground with a hole in
// the middle," which changes edgeguard/recovery play (an off-stage knockback
// toward centre can now mean falling through the gap instead of just being
// knocked off the side) without adding any wall physics the sim doesn't have.
import * as fx from '../../../../sim/src/math/fixed.ts';
import type { ArenaData } from '../../../../sim/src/arena/types.ts';

export const THE_UNDERCROFT_ARENA: ArenaData = {
  name: 'The Undercroft',
  // Cold blue-grey accent: distinct from the neutral Colosseum and the
  // warm Spire, reads as "open air/chasm" rather than danger (kept well
  // clear of the red/amber hues reserved for hazard telegraphs).
  accentColor: 0x4c7a9e,
  platforms: [
    // Left ground slab.
    { minX: fx.fromInt(-560), maxX: fx.fromInt(-80), y: fx.fromInt(0) },
    // Right ground slab -- mirror of the left, with an 160-unit gap
    // between -80 and 80 that has no floor at all: fall through it and
    // you are in open air over the blast zone's lower half, same as any
    // other whiff off the side.
    { minX: fx.fromInt(80), maxX: fx.fromInt(560), y: fx.fromInt(0) },
    // A single high bridge platform spanning the gap's centre -- the only
    // route across without dropping to the blast zone, and also the stage's
    // one contested king-of-the-hill perch. Wide enough (120 units) that
    // the fully-shrunk endgame blast rectangle (see below) always keeps
    // solid footing under its own centre. Pass-through: a fighter holding
    // the bridge can be forced to give it up by dropping through instead
    // of only by being knocked off, and a defender crossing under threat
    // can bail through it into the chasm on their own terms.
    { minX: fx.fromInt(-60), maxX: fx.fromInt(60), y: fx.fromInt(90), kind: 'pass-through' },
  ],
  blastMinX: fx.fromInt(-640),
  blastMaxX: fx.fromInt(640),
  blastMinY: fx.fromInt(-260),
  blastMaxY: fx.fromInt(480),
  // 10 spawns per side, spread along each ground slab, well clear of the
  // chasm edge (closest spawn point is 100 units from the gap) and of the
  // outer blast zone.
  // HUMAN-SURVIVAL FIX (2026-09-10): same fix as battle-royale-20 -- see
  // that file's comment. Reversed so low fighter indices (always human
  // seats) land at the outer edge of the spread, not the centre.
  // SPAWN-CLEARANCE FIX 2026-09-11 (see wiki "Spawn Clearance Audit: All
  // Stages 2026-09-11"): 38-unit-per-slot spacing put the outermost spawn
  // (x=522) only 82.8 units from the live tick-0 boundary (maxX=604.8),
  // less than the ~108-unit worst-case early-hit arc. Compressed per-slot
  // spacing from 38 to 32 (outermost spawn moves to x=468, chasm-edge
  // clearance for the innermost spawn is unchanged at 100 units): gives
  // 136.8 units of boundary clearance, a 1.26x safety factor.
  spawnPoints: Array.from({ length: 20 }, (_, i) => {
    const slot = 9 - Math.floor(i / 2);
    const side = i % 2 === 0 ? 1 : -1;
    const x = side * fx.fromInt(180 + slot * 32);
    return { x, y: fx.fromInt(0) };
  }),
};
