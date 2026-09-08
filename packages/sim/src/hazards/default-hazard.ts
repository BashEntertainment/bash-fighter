// Sim's own default hazard config (mirrors DEFAULT_ARENA/DEFAULT_ITEM_SET):
// keeps packages/sim self-contained with no import from packages/content.
import * as fx from '../math/fixed.ts';
import type { HazardConfig } from './types.ts';

export const DEFAULT_HAZARD_CONFIG: HazardConfig = {
  name: 'Falling Debris',
  spawnIntervalMaxTicks: 420, // 7s
  spawnIntervalMinTicks: 90, // 1.5s once the arena is fully closed
  fallAccel: fx.fromFloat(-0.5),
  boxWidth: fx.fromFloat(2.0),
  boxHeight: fx.fromFloat(2.0),
  damage: fx.fromInt(8),
  baseKnockback: fx.fromFloat(5.0),
  knockbackGrowth: fx.fromFloat(0.5),
  angleIdx: 256, // straight up
  maxLifetimeTicks: 600,
};
