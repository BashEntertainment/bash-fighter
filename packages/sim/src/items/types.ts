// Item type definitions as data (this task's item 1 / Engine Architecture
// part 2 section 7 convention: packages/content authors these,
// packages/sim only consumes the type — same one-way dependency direction
// as CharacterData/ArenaData). An item's *behavior* (falling, pickup,
// held-follow, use-effect, despawn) lives in sim.ts; only its *tuning* is
// data here, so a contributor adding a new item type edits a table, not
// sim.ts.
import type { Fixed } from '../math/fixed.ts';

export const ItemTypeId = {
  THROWN: 0, // picked up and hurled: a straight-line projectile that hits the first fighter it touches.
  BAT: 1, // melee: one swing in front of the holder, high knockback, then consumed.
  BOMB: 2, // dropped, arms, explodes after a fuse: damages/launches everyone in radius, holder included.
  HEAL: 3, // consumed instantly on use: reduces the holder's percent.
} as const;
export type ItemTypeIdValue = (typeof ItemTypeId)[keyof typeof ItemTypeId];

export type ItemKind = 'thrown' | 'melee' | 'explosive' | 'heal';

export interface ItemTypeDef {
  id: ItemTypeIdValue;
  name: string;
  kind: ItemKind;
  /** World-space box used both for on-ground pickup overlap and (for
   * 'thrown'/'explosive') the effect's hit/blast box. */
  boxWidth: Fixed;
  boxHeight: Fixed;
  damage: Fixed;
  baseKnockback: Fixed;
  knockbackGrowth: Fixed;
  /** LUT index (0..1023) for knockback direction, authored as if the user
   * faces right; mirrored the same way a hitbox angle is. 'explosive'
   * ignores this and always launches straight up (see sim.ts) so there is
   * no atan2/direction-to-target computation needed to stay deterministic
   * and float-free. */
  angleIdx: number;
  /** 'thrown' only: straight-line flight speed, Fixed velocity units. */
  projectileSpeed: Fixed;
  /** 'explosive' only: ticks from use to detonation. */
  fuseTicks: number;
  /** 'heal' only: percent removed from the holder on use. */
  healAmount: Fixed;
  /** Ticks a world (unheld, unthrown) instance survives before despawning. */
  despawnTicks: number;
}

export type ItemSet = readonly ItemTypeDef[];

export function findItemType(set: ItemSet, id: number): ItemTypeDef | undefined {
  return set.find((t) => t.id === id);
}
