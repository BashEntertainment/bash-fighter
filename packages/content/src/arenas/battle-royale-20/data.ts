// 20-player battle-royale arena (this task's item 4): multiple flat
// platforms at varied heights spread across a wide span, with a generous
// blast zone sized for a 20-fighter FFA — the sim's arena-shrink schedule
// (packages/sim/src/arena-shrink.ts) closes this down as the field thins,
// so the starting geometry can afford to be this large.
import * as fx from '../../../../sim/src/math/fixed.ts';
import type { ArenaData } from '../../../../sim/src/arena/types.ts';

export const BATTLE_ROYALE_20_ARENA: ArenaData = {
  name: 'Bash Colosseum (20p)',
  // Neutral stone-grey accent: the balanced, original stage -- no strong
  // personality, everything else is judged against it.
  accentColor: 0x9aa0a8,
  platforms: [
    // Wide main ground -- solid: this is the stage's floor, you cannot
    // fall through it, matching every other stage's ground.
    { minX: fx.fromInt(-480), maxX: fx.fromInt(480), y: fx.fromInt(0) },
    // A ring of mid-height platforms for vertical play and to break up
    // line-of-sight/spacing at 20 fighters. All 'pass-through': jump up
    // into them from below and land on top as before, but now a fighter
    // standing on one can hold down+jump to drop through deliberately
    // instead of only being able to leave by walking off the edge or
    // being knocked off -- the primitive this stage was missing.
    { minX: fx.fromInt(-360), maxX: fx.fromInt(-220), y: fx.fromInt(70), kind: 'pass-through' },
    { minX: fx.fromInt(220), maxX: fx.fromInt(360), y: fx.fromInt(70), kind: 'pass-through' },
    { minX: fx.fromInt(-70), maxX: fx.fromInt(70), y: fx.fromInt(110), kind: 'pass-through' },
    // Two small high perches near center for king-of-the-hill skirmishes
    // -- also pass-through, so a camper can be forced off by an opponent
    // who takes the perch, or can bail downward on their own terms
    // instead of only sideways into open air.
    { minX: fx.fromInt(-180), maxX: fx.fromInt(-100), y: fx.fromInt(160), kind: 'pass-through' },
    { minX: fx.fromInt(100), maxX: fx.fromInt(180), y: fx.fromInt(160), kind: 'pass-through' },
  ],
  blastMinX: fx.fromInt(-620),
  blastMaxX: fx.fromInt(620),
  blastMinY: fx.fromInt(-260),
  blastMaxY: fx.fromInt(520),
  // 20 spawn points spread across the main platform, alternating sides so
  // adjacent fighter indices don't start adjacent on stage.
  //
  // BUG FIX (this task's stage audit): the previous formula used
  // `i % 10` as the slot, which repeats every 10 indices -- fighters 0
  // and 10, 1 and 11, ... 9 and 19 were all assigned the exact same (x, y)
  // spawn point, i.e. 20 "spawn points" that were really only 10 unique
  // positions, each stacked with two fighters on top of each other at
  // match start. `Math.floor(i / 2)` makes every one of the 20 positions
  // distinct while keeping the alternating-sides property.
  spawnPoints: Array.from({ length: 20 }, (_, i) => {
    const slot = Math.floor(i / 2);
    const side = i % 2 === 0 ? 1 : -1;
    const x = side * fx.fromInt(40 + slot * 40);
    return { x, y: fx.fromInt(0) };
  }),
};
