// Stage hazard tuning as data (this task's item 2), same one-way
// dependency direction as ItemTypeDef/CharacterData/ArenaData: packages/sim
// only consumes this type, packages/content authors the real numbers.
//
// A single hazard "kind" is implemented (a falling rock that drops from
// the top of the current blast rect at a PRNG-chosen X and knocks upward
// anyone it clips) because the task asks for at minimum one, coordinated
// with arena-shrink. The spawn *interval* itself shrinks from
// spawnIntervalMaxTicks down to spawnIntervalMinTicks as
// computeShrinkProgress (arena-shrink.ts) goes from 0 to 1, so hazards
// intensify in lockstep with the collapsing arena and thinning field
// rather than on an independent clock.
import type { Fixed } from '../math/fixed.ts';

export interface HazardConfig {
  name: string;
  /** Ticks between spawns when shrink progress is 0 (start of match). */
  spawnIntervalMaxTicks: number;
  /** Ticks between spawns once shrink progress reaches 1 (fully closed). */
  spawnIntervalMinTicks: number;
  /** Downward speed added to the hazard's fall each tick (Fixed, same
   * units as sim GRAVITY but authored separately so hazards can fall
   * faster/slower than a fighter without touching combat tuning). */
  fallAccel: Fixed;
  boxWidth: Fixed;
  boxHeight: Fixed;
  damage: Fixed;
  baseKnockback: Fixed;
  knockbackGrowth: Fixed;
  /** Straight up: no atan2/direction-to-target needed, matching the
   * explosive item's approach, so the hazard stays float-free. */
  angleIdx: number;
  /** Safety despawn if it somehow never leaves the blast rect (should not
   * happen given fallAccel + blast rect bounds, but keeps the hazard slot
   * pool bounded regardless). */
  maxLifetimeTicks: number;
}
