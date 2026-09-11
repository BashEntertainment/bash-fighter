// The Atoll: three ground islands separated by open water (no floor,
// no walls), crossable only via two pass-through bridges arcing above
// the gaps. Where The Undercroft has one chasm and The Foundry has
// walled pockets on an unbroken floor, The Atoll has neither a single
// floor nor any wall -- it is the "flat brawl with a hole in the
// middle" idea taken to three landmasses instead of two, so there are
// two contested gaps instead of one and no wall ever blocks a
// horizontal escape, only the lack of ground beneath it. A fighter
// knocked off a bridge falls straight into the gap's blast zone, same
// as any other off-stage knockback -- there is nothing to walk into,
// only water to fall through.
import * as fx from '../../../../sim/src/math/fixed.ts';
import type { ArenaData } from '../../../../sim/src/arena/types.ts';

export const THE_ATOLL_ARENA: ArenaData = {
  name: 'The Atoll',
  // Teal/turquoise accent: reads as "water/coast", clearly distinct from
  // the Colosseum's neutral grey, the Undercroft's cold blue-grey, the
  // Spire's cool violet, and the Foundry's warm ember-orange -- and well
  // clear of the red/amber hues reserved for hazard telegraphs.
  accentColor: 0x2f8f7a,
  platforms: [
    // Left island.
    { minX: fx.fromInt(-520), maxX: fx.fromInt(-200), y: fx.fromInt(0) },
    // Centre island -- alone wide enough (240 units) to hold the fully
    // shrunk endgame rectangle, same margin as The Foundry's centre
    // chamber, so the safe zone never closes onto open water.
    { minX: fx.fromInt(-120), maxX: fx.fromInt(120), y: fx.fromInt(0) },
    // Right island -- mirror of the left.
    { minX: fx.fromInt(200), maxX: fx.fromInt(520), y: fx.fromInt(0) },
    // Left bridge: pass-through, spans the left gap (-200..-120) with a
    // little overhang either side. Bailing downward through it drops a
    // fighter straight into the gap, same choice as The Undercroft's
    // bridge.
    // VERTICAL CLEARANCE FIX 2026-09-11 (see wiki "The Atoll: Vertical
    // Clearance and Low-Percent Knockouts 2026-09-11"): bridge y raised
    // from 70 to 82. computeGroundHalfExtents() derives the live ceiling
    // from the highest platform any fighter can stand on (here, the
    // bridge) plus its margin -- at y=70 that gave only 90 units of
    // ceiling clearance against the roster's worst-case 85.1-unit upward
    // launch arc (a 1.06x safety factor, the thinnest of any stage in any
    // direction). Raising the bridge's own y is a pure stage-geometry
    // change -- no knockback/physics constant touched -- and widens the
    // ceiling by the same 12 units, to 1.20x, clearing the same >=1.15x
    // bar the horizontal check already uses. Cosmetic effect only:
    // bridges sit slightly higher above the islands.
    { minX: fx.fromInt(-210), maxX: fx.fromInt(-110), y: fx.fromInt(82), kind: 'pass-through' },
    // Right bridge: mirror of the left, spans the right gap (120..200).
    { minX: fx.fromInt(110), maxX: fx.fromInt(210), y: fx.fromInt(82), kind: 'pass-through' },
  ],
  blastMinX: fx.fromInt(-600),
  blastMaxX: fx.fromInt(600),
  blastMinY: fx.fromInt(-260),
  blastMaxY: fx.fromInt(560),
  // 20 spawns split 7/6/7 across the three islands, mirroring The
  // Foundry's chamber split -- centre island is narrower so it gets one
  // fewer spawn. Within each island, low fighter indices (always human
  // seats -- server/src/rooms.ts adds human seats before bot fill) land
  // at the outer edge of the spread, not the centre, following the same
  // human-survival fix applied to every other stage (see "Bot Difficulty
  // Correction and Human-Survival Fix 2026-09-10").
  spawnPoints: [
    // Left island (7 spawns). SPAWN-CLEARANCE FIX 2026-09-11 (see wiki
    // "Spawn Clearance Audit: All Stages 2026-09-11"): the outermost slot
    // (i=6, nearest the stage edge/blast zone) was only 81.6 units from
    // the live tick-0 boundary (maxX=561.6) against a ~108-unit
    // worst-case early-hit arc -- production evidence from 2026-09-11
    // showed two bots knocked out at 3.3s at 4% and 11%, on exactly this
    // spawn pattern. Compressed per-slot spacing from 40 to 28 units,
    // anchored at the same inner (i=0) position: outer slot moves from
    // x=-480 to x=-408, giving 153.6 units of clearance (1.42x safety
    // factor).
    ...Array.from({ length: 7 }, (_, i) => ({
      x: fx.fromInt(-240 - i * 28),
      y: fx.fromInt(0),
    })),
    // Centre island (6 spawns), x roughly -90..90.
    ...Array.from({ length: 6 }, (_, i) => ({
      x: fx.fromInt(-90 + i * 36),
      y: fx.fromInt(0),
    })),
    // Right island (7 spawns). SPAWN-CLEARANCE FIX 2026-09-11: mirror of
    // the left island's fix above -- outer slot moves from x=480 to
    // x=408 (clearance 153.6, factor 1.42).
    ...Array.from({ length: 7 }, (_, i) => ({
      x: fx.fromInt(240 + i * 28),
      y: fx.fromInt(0),
    })),
  ],
};
