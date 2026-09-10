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
  spawnPoints: [
    // Left chamber (7 spawns), x in roughly -420..-160.
    ...Array.from({ length: 7 }, (_, i) => ({
      x: fx.fromInt(-420 + i * 40),
      y: fx.fromInt(0),
    })),
    // Centre chamber (6 spawns), x in roughly -110..110.
    ...Array.from({ length: 6 }, (_, i) => ({
      x: fx.fromInt(-110 + i * 44),
      y: fx.fromInt(0),
    })),
    // Right chamber (7 spawns), x in roughly 160..420.
    ...Array.from({ length: 7 }, (_, i) => ({
      x: fx.fromInt(160 + i * 40),
      y: fx.fromInt(0),
    })),
  ],
};
