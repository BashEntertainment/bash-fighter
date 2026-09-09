// Arena/stage geometry as data (Engine Architecture part 2 section 7 /
// this task's item 4): a stage is a list of flat platforms plus a
// blast-zone rectangle and a list of spawn points. packages/content
// authors these; packages/sim only consumes the type, same one-way
// dependency direction as CharacterData.
import type { Fixed } from '../math/fixed.ts';

/** A single flat platform: ground between minX..maxX at height y.
 * Platforms do not stack; a falling fighter lands on the first platform
 * (in array order) whose x-range contains it and whose y its trajectory
 * crosses this tick.
 *
 * `kind` distinguishes the two surface behaviours the sim understands:
 * - 'solid' (default when omitted, for backward compatibility with older
 *   arena data): once landed on, only leaving its x-range or being
 *   knocked away separates a fighter from it. Use for a stage's main
 *   ground -- you cannot fall through the floor.
 * - 'pass-through': identical landing behaviour when falling onto it from
 *   above, but a grounded fighter standing on one who holds stick-down and
 *   presses jump drops through it deliberately (see DROP_THROUGH_TICKS
 *   and the per-fighter drop-through timer in sim.ts). Use for
 *   secondary/upper platforms.
 *
 * Ascending through *any* platform from below already worked before this
 * change and is unchanged: the landing check only fires on a downward
 * y-crossing, so jumping up into the underside of a platform was never
 * blocked. This field only adds the deliberate *downward* pass-through a
 * fighter chooses, and only for 'pass-through' platforms. */
export interface Platform {
  minX: Fixed;
  maxX: Fixed;
  y: Fixed;
  kind?: 'solid' | 'pass-through';
}

/** A vertical solid wall segment blocking horizontal movement between
 * minY..maxY at position x. Unlike Platform, a wall has no "from above"
 * distinction -- it blocks any fighter whose feet (posY) fall in its
 * y-range from crossing its x plane, from either side. Used for stage
 * enclosure (pits, corridors); walls do not participate in landing at
 * all, only in horizontal clamping. */
export interface Wall {
  x: Fixed;
  minY: Fixed;
  maxY: Fixed;
}

export interface SpawnPoint {
  x: Fixed;
  y: Fixed;
}

export interface ArenaData {
  name: string;
  platforms: readonly Platform[];
  /** Optional vertical wall segments for stage enclosure. Defaults to
   * none when omitted, so existing arena data still validates. */
  walls?: readonly Wall[];
  blastMinX: Fixed;
  blastMaxX: Fixed;
  blastMinY: Fixed;
  blastMaxY: Fixed;
  /** Spawn/respawn points, cycled by fighter index modulo length so an
   * arena can define fewer points than the match's fighter count. */
  spawnPoints: readonly SpawnPoint[];
  /** Cosmetic only: a restrained accent colour (0xRRGGBB) the renderer may
   * use for this stage's platform edge highlight, so stages read as
   * visually distinct without touching fill colour, gradients, or any
   * colour reserved for danger/warning. Never read by packages/sim --
   * purely a hint the renderer chooses to use or ignore. Optional so
   * existing/omitted data still validates. */
  accentColor?: number;
}
