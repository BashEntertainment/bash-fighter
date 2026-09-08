// Arena/stage geometry as data (Engine Architecture part 2 section 7 /
// this task's item 4): a stage is a list of flat platforms plus a
// blast-zone rectangle and a list of spawn points. packages/content
// authors these; packages/sim only consumes the type, same one-way
// dependency direction as CharacterData.
import type { Fixed } from '../math/fixed.ts';

/** A single flat platform: solid ground between minX..maxX at height y.
 * Platforms do not stack; a falling fighter lands on the first platform
 * (in array order) whose x-range contains it and whose y its trajectory
 * crosses this tick. */
export interface Platform {
  minX: Fixed;
  maxX: Fixed;
  y: Fixed;
}

export interface SpawnPoint {
  x: Fixed;
  y: Fixed;
}

export interface ArenaData {
  name: string;
  platforms: readonly Platform[];
  blastMinX: Fixed;
  blastMaxX: Fixed;
  blastMinY: Fixed;
  blastMaxY: Fixed;
  /** Spawn/respawn points, cycled by fighter index modulo length so an
   * arena can define fewer points than the match's fighter count. */
  spawnPoints: readonly SpawnPoint[];
}
