// The Foundry: a continuous ground floor divided into three walled
// chambers. Where The Undercroft removes floor (a chasm you fall
// through) and The Spire removes width (a shaft you climb), The Foundry
// removes neither -- the floor is one unbroken solid slab -- and instead
// drops two full-height walls straight up out of it, splitting ground
// level into a left/centre/right pocket that cannot be walked between.
// The only way across is up and over: two low pass-through ledges sit
// just above each wall's top, so crossing means committing to a jump
// arc through open air over a wall that will not budge, not drifting
// past a platform edge. This is the stage's genuinely new primitive use:
// the other two stages use walls (Spire) or gaps (Undercroft) but never
// a wall that fully encloses ground-level pockets a fighter spawns
// inside of.
import * as fx from '../../../../sim/src/math/fixed.ts';
import type { ArenaData } from '../../../../sim/src/arena/types.ts';

export const THE_FOUNDRY_ARENA: ArenaData = {
  name: 'The Foundry',
  // Warm ember-orange accent, kept clearly on the orange side rather
  // than amber (amber is reserved for hazard/danger cues, see
  // PALETTE in packages/render/src/palette.ts) -- reads as "forge/kiln"
  // and is distinct from the Colosseum's neutral grey, the Spire's cool
  // violet, and the Undercroft's cold blue.
  accentColor: 0xc25a2c,
  platforms: [
    // One unbroken solid ground floor spanning all three chambers --
    // there is no chasm here, unlike The Undercroft. Wide enough alone
    // to hold all 20 spawns under the fully-shrunk endgame rectangle.
    { minX: fx.fromInt(-440), maxX: fx.fromInt(440), y: fx.fromInt(0) },
    // Left crossing ledge: sits just above the left wall's top, wide
    // enough to land on deliberately but too narrow to camp safely.
    // Pass-through so a fighter who crosses can bail downward into
    // either neighbouring chamber instead of only forward/back along it.
    { minX: fx.fromInt(-190), maxX: fx.fromInt(-90), y: fx.fromInt(150), kind: 'pass-through' },
    // Right crossing ledge: mirror of the left.
    { minX: fx.fromInt(90), maxX: fx.fromInt(190), y: fx.fromInt(150), kind: 'pass-through' },
    // A single small perch above the centre chamber -- the stage's one
    // king-of-the-hill spot, positioned so it does not directly connect
    // to either crossing ledge (a fighter must commit to a full jump arc
    // from the centre floor, not a short hop from a ledge).
    { minX: fx.fromInt(-40), maxX: fx.fromInt(40), y: fx.fromInt(210), kind: 'pass-through' },
  ],
  // The two chamber-dividing walls. Full-height from the floor (y=0) to
  // just above the crossing ledges (y=170), so a fighter cannot walk,
  // jump-cancel through the side, or be knocked sideways through a wall
  // at any height a grounded or lightly-airborne fighter would occupy --
  // only clearing the ledge height at y=150 gets over the top.
  walls: [
    { x: fx.fromInt(-140), minY: fx.fromInt(0), maxY: fx.fromInt(170) },
    { x: fx.fromInt(140), minY: fx.fromInt(0), maxY: fx.fromInt(170) },
  ],
  blastMinX: fx.fromInt(-520),
  blastMaxX: fx.fromInt(520),
  blastMinY: fx.fromInt(-260),
  blastMaxY: fx.fromInt(560),
  // 20 spawns split evenly across the three chambers (7/6/7) so nobody
  // starts already boxed in alone with a crowd -- centre chamber is
  // narrower (280 units between walls vs 300 in each side chamber) so it
  // gets one fewer spawn than each side. Human seats always get the
  // lowest fighter indices (server/src/rooms.ts adds human seats before
  // bot fill) -- following the same fix applied to the other three
  // stages (see "Bot Difficulty Correction and Human-Survival Fix
  // 2026-09-10"), low indices are placed at the outer edge of each
  // chamber's spread, not stacked at the centre where the group is most
  // crowded at tick 0.
  // BLAST-ZONE PROXIMITY FIX (2026-09-11, see wiki "Low-Percent Knockouts
  // and Stage Blast Zones 2026-09-11"): the human-survival fix's "low
  // index = outer edge of the spread" rule was written against The
  // Undercroft, where the outer edge is the safe direction (away from the
  // centre chasm). On The Foundry the outer edge of each side chamber is
  // instead the direction *toward the stage's own edge and the blast
  // zone* -- production evidence showed the sole human seat (always
  // index 0, always the outermost spawn in the left chamber at x=-420)
  // eliminated by knockout at 22% damage 3.5s into the match. Side
  // chambers now spawn low indices at the *inner* end (toward the
  // chamber-dividing wall, away from the stage edge) instead; the centre
  // chamber is unaffected since it is walled on both sides and was never
  // the reported problem.
  spawnPoints: [
    // Left chamber (7 spawns), x in roughly -420..-160, low indices inner
    // (near the -140 dividing wall) rather than outer (near the -440
    // stage edge / blast zone).
    ...Array.from({ length: 7 }, (_, i) => ({
      x: fx.fromInt(-420 + (6 - i) * 40),
      y: fx.fromInt(0),
    })),
    // Centre chamber (6 spawns), x in roughly -110..110 -- unaffected,
    // walled on both sides.
    ...Array.from({ length: 6 }, (_, i) => ({
      x: fx.fromInt(-110 + i * 44),
      y: fx.fromInt(0),
    })),
    // Right chamber (7 spawns), x in roughly 160..420. Unaffected: index 0
    // here was already the inner slot (near the 140 dividing wall, x=160)
    // before this fix, so it never exhibited the bug -- only the left
    // chamber's index-0-at-the-stage-edge mapping did.
    ...Array.from({ length: 7 }, (_, i) => ({
      x: fx.fromInt(160 + i * 40),
      y: fx.fromInt(0),
    })),
  ],
};
