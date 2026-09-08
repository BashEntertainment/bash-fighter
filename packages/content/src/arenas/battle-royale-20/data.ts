// 20-player battle-royale arena (this task's item 4): multiple flat
// platforms at varied heights spread across a wide span, with a generous
// blast zone sized for a 20-fighter FFA — the sim's arena-shrink schedule
// (packages/sim/src/arena-shrink.ts) closes this down as the field thins,
// so the starting geometry can afford to be this large.
import * as fx from '../../../../sim/src/math/fixed.ts';
import type { ArenaData } from '../../../../sim/src/arena/types.ts';

export const BATTLE_ROYALE_20_ARENA: ArenaData = {
  name: 'Bash Colosseum (20p)',
  platforms: [
    // Wide main ground.
    { minX: fx.fromInt(-480), maxX: fx.fromInt(480), y: fx.fromInt(0) },
    // A ring of mid-height platforms for vertical play and to break up
    // line-of-sight/spacing at 20 fighters.
    { minX: fx.fromInt(-360), maxX: fx.fromInt(-220), y: fx.fromInt(70) },
    { minX: fx.fromInt(220), maxX: fx.fromInt(360), y: fx.fromInt(70) },
    { minX: fx.fromInt(-70), maxX: fx.fromInt(70), y: fx.fromInt(110) },
    // Two small high perches near center for king-of-the-hill skirmishes.
    { minX: fx.fromInt(-180), maxX: fx.fromInt(-100), y: fx.fromInt(160) },
    { minX: fx.fromInt(100), maxX: fx.fromInt(180), y: fx.fromInt(160) },
  ],
  blastMinX: fx.fromInt(-620),
  blastMaxX: fx.fromInt(620),
  blastMinY: fx.fromInt(-260),
  blastMaxY: fx.fromInt(520),
  // 20 spawn points spread across the main platform, alternating sides so
  // adjacent fighter indices don't start adjacent on stage.
  spawnPoints: Array.from({ length: 20 }, (_, i) => {
    const slot = i % 10;
    const side = i % 2 === 0 ? 1 : -1;
    const x = side * fx.fromInt(40 + slot * 40);
    return { x, y: fx.fromInt(0) };
  }),
};
