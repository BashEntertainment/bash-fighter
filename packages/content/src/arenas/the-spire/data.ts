// The Spire: a narrow, tall vertical tower. Where Bash Colosseum spreads
// wide and The Undercroft is a flat brawl with a hole in the floor, The
// Spire is deliberately cramped horizontally and stretched vertically --
// four stacked platform tiers above a modest ground floor, all narrow
// enough that there is nowhere to run and the fight is forced upward:
// juggles, edgeguards off the tiers, and contested high ground replace the
// horizontal spacing game the wider stages reward.
import * as fx from '../../../../sim/src/math/fixed.ts';
import type { ArenaData } from '../../../../sim/src/arena/types.ts';

export const THE_SPIRE_ARENA: ArenaData = {
  name: 'The Spire',
  // Warm ember accent -- distinct from the Colosseum's neutral grey and
  // the Undercroft's cold blue, reads as "tower/height" rather than
  // danger or warning (kept clear of the reserved red/amber hues).
  accentColor: 0xb0703a,
  platforms: [
    // Ground floor -- wide enough on its own to hold all 20 spawns, so
    // the fully-shrunk endgame rectangle always keeps solid footing
    // regardless of which tier is contested. Solid: the stage's floor.
    { minX: fx.fromInt(-220), maxX: fx.fromInt(220), y: fx.fromInt(0) },
    // Tier 1: two platforms flanking the centre, low enough to be a quick
    // first hop up. Pass-through, like every tier above the ground --
    // this is the stage the drop-through primitive matters most for:
    // juggling and edgeguarding off a tier only works if the defender can
    // also choose to bail downward through it.
    { minX: fx.fromInt(-160), maxX: fx.fromInt(-60), y: fx.fromInt(80), kind: 'pass-through' },
    { minX: fx.fromInt(60), maxX: fx.fromInt(160), y: fx.fromInt(80), kind: 'pass-through' },
    // Tier 2: narrower again, offset toward the centre.
    { minX: fx.fromInt(-110), maxX: fx.fromInt(-20), y: fx.fromInt(160), kind: 'pass-through' },
    { minX: fx.fromInt(20), maxX: fx.fromInt(110), y: fx.fromInt(160), kind: 'pass-through' },
    // Tier 3: a single small perch at the very top -- the stage's one
    // king-of-the-hill spot, deliberately too small to be a safe camp.
    { minX: fx.fromInt(-40), maxX: fx.fromInt(40), y: fx.fromInt(240), kind: 'pass-through' },
  ],
  // Two vertical walls just outside the tier platforms' widest extent,
  // starting just above the ground floor and running to the top perch.
  // Below y=60 the tower is fully open (the ground floor spans -220..220
  // uninterrupted); above it, the walls narrow the playable column to
  // -170..170 so climbing the tower means committing to its shaft rather
  // than drifting past the tiers in open air on either side. This is the
  // stage's one deliberate use of hard walls: it turns "tower you can
  // fly around" into "shaft you climb through or get walled into."
  walls: [
    { x: fx.fromInt(-170), minY: fx.fromInt(60), maxY: fx.fromInt(260) },
    { x: fx.fromInt(170), minY: fx.fromInt(60), maxY: fx.fromInt(260) },
  ],
  // Narrower than Colosseum's 1240-unit span (760 here) and taller than
  // its 780-unit vertical span (900 here): the width/height ratio, not
  // just the platform count, is what makes this read as a tower rather
  // than a rearranged flat stage.
  blastMinX: fx.fromInt(-380),
  blastMaxX: fx.fromInt(380),
  blastMinY: fx.fromInt(-260),
  blastMaxY: fx.fromInt(640),
  // All 20 spawns on the ground floor -- it's the only platform wide
  // enough to hold them without overlap (hurtbox width is 16 units; 22-unit
  // spacing leaves a comfortable margin), and starting everyone on the
  // floor is what makes the tower something fighters climb into rather
  // than a stage some spawn already contesting.
  spawnPoints: Array.from({ length: 20 }, (_, i) => {
    const x = fx.fromInt(-209 + i * 22);
    return { x, y: fx.fromInt(0) };
  }),
};
