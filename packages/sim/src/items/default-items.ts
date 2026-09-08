// Sim's own default item set (mirrors DEFAULT_ARENA / DEFAULT_CHARACTER):
// keeps packages/sim self-contained and testable with no import from
// packages/content. Real, tuned content lives in
// packages/content/src/items/data.ts.
import * as fx from '../math/fixed.ts';
import { ItemTypeId, type ItemSet } from './types.ts';

export const DEFAULT_ITEM_SET: ItemSet = [
  {
    id: ItemTypeId.THROWN,
    name: 'Debug Rock',
    kind: 'thrown',
    boxWidth: fx.fromFloat(1.2),
    boxHeight: fx.fromFloat(1.2),
    damage: fx.fromInt(5),
    baseKnockback: fx.fromFloat(4.0),
    knockbackGrowth: fx.fromFloat(0.4),
    angleIdx: 60,
    projectileSpeed: fx.fromFloat(9.0),
    fuseTicks: 0,
    healAmount: 0,
    despawnTicks: 600,
  },
];
