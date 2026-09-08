// Real item content for the 20-player battle royale (this task's item 1).
// Four types chosen to create chaos in a large FFA without needing any
// new sim mechanics beyond what's in packages/sim/src/items/types.ts:
//
// - Thrown Brick: a straight-line projectile. Lets a fighter threaten
//   someone across the arena instead of only in melee range, which matters
//   a lot at 20 players spread across a wide stage.
// - Slam Bat: single devastating melee swing. A comeback tool for a
//   fighter who is losing a straight damage race — high knockback can
//   remove someone from a stock fight instantly.
// - Bash Bomb: drop-and-arm explosive that hits everyone in its radius,
//   including the holder if they're too slow to clear the blast. Rewards
//   good positioning/timing and punishes greedy holding, which is exactly
//   the kind of swingy risk an FFA benefits from.
// - Medkit: instant percent reduction. The only "catch-up" item, so a
//   fighter who is behind on damage has a reason to fight for neutral
//   items instead of only avoiding the leader.
//
// Numbers are this project's own first-cut tuning (see the per-move table
// in Combat Model wiki page for the scale they should feel consistent
// with), not balanced against real playtesting yet.
import * as fx from '../../../sim/src/math/fixed.ts';
import { ItemTypeId, type ItemSet } from '../../../sim/src/items/types.ts';

export const BASH_FIGHTER_ITEM_SET: ItemSet = [
  {
    id: ItemTypeId.THROWN,
    name: 'Thrown Brick',
    kind: 'thrown',
    boxWidth: fx.fromFloat(1.0),
    boxHeight: fx.fromFloat(1.0),
    damage: fx.fromInt(7),
    baseKnockback: fx.fromFloat(5.0),
    knockbackGrowth: fx.fromFloat(0.45),
    angleIdx: 70,
    projectileSpeed: fx.fromFloat(10.0),
    fuseTicks: 0,
    healAmount: 0,
    despawnTicks: 600,
  },
  {
    id: ItemTypeId.BAT,
    name: 'Slam Bat',
    kind: 'melee',
    boxWidth: fx.fromFloat(2.4),
    boxHeight: fx.fromFloat(1.6),
    damage: fx.fromInt(14),
    baseKnockback: fx.fromFloat(12.0),
    knockbackGrowth: fx.fromFloat(0.9),
    angleIdx: 100,
    projectileSpeed: 0,
    fuseTicks: 0,
    healAmount: 0,
    despawnTicks: 900,
  },
  {
    id: ItemTypeId.BOMB,
    name: 'Bash Bomb',
    kind: 'explosive',
    boxWidth: fx.fromFloat(4.0),
    boxHeight: fx.fromFloat(4.0),
    damage: fx.fromInt(18),
    baseKnockback: fx.fromFloat(9.0),
    knockbackGrowth: fx.fromFloat(0.7),
    angleIdx: 256,
    projectileSpeed: 0,
    fuseTicks: 90, // 1.5s to clear the blast radius
    healAmount: 0,
    despawnTicks: 900,
  },
  {
    id: ItemTypeId.HEAL,
    name: 'Medkit',
    kind: 'heal',
    boxWidth: fx.fromFloat(1.2),
    boxHeight: fx.fromFloat(1.2),
    damage: 0,
    baseKnockback: 0,
    knockbackGrowth: 0,
    angleIdx: 0,
    projectileSpeed: 0,
    fuseTicks: 0,
    healAmount: fx.fromInt(25),
    despawnTicks: 600,
  },
];
