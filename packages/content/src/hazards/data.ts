// Real hazard content (this task's item 2): one recurring hazard, falling
// debris, tuned to intensify with arena-shrink (see
// packages/sim/src/hazards/types.ts for how the interval scales).
import * as fx from '../../../sim/src/math/fixed.ts';
import type { HazardConfig } from '../../../sim/src/hazards/types.ts';

export const BASH_FIGHTER_HAZARD: HazardConfig = {
  name: 'Falling Debris',
  spawnIntervalMaxTicks: 360, // 6s at the start of the match
  spawnIntervalMinTicks: 60, // 1s once the ring is fully closed
  fallAccel: fx.fromFloat(-0.6),
  boxWidth: fx.fromFloat(2.4),
  boxHeight: fx.fromFloat(2.4),
  damage: fx.fromInt(10),
  baseKnockback: fx.fromFloat(6.0),
  knockbackGrowth: fx.fromFloat(0.55),
  angleIdx: 256,
  maxLifetimeTicks: 600,
};
