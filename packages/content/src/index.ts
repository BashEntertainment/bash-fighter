// Character/stage TypeScript data modules + schema validator (Engine
// Architecture part 2 section 7). packages/render, packages/net and
// packages/app are still out of scope stubs; this package now provides
// real content: the placeholder character and a validator a contributor's
// PR runs before merge.
export * from './validate.ts';
export { PLACEHOLDER_CHARACTER } from './characters/placeholder/data.ts';
export { BALLAST_CHARACTER } from './characters/ballast/data.ts';
export { VOLTLING_CHARACTER } from './characters/voltling/data.ts';
export { REED_CHARACTER } from './characters/reed/data.ts';
export {
  ALL_CHARACTERS,
  DEFAULT_CHARACTER_ID,
  resolveCharacterId,
  isKnownCharacterId,
  type CharacterEntry,
} from './characters.ts';
export { BATTLE_ROYALE_20_ARENA } from './arenas/battle-royale-20/data.ts';
export { BASH_FIGHTER_ITEM_SET } from './items/data.ts';
export { BASH_FIGHTER_HAZARD } from './hazards/data.ts';
export { createMatchSim } from './match-sim.ts';
export type { AnimationParams } from './animation/types.ts';
export { PLACEHOLDER_ANIMATION } from './characters/placeholder/animation.ts';
export { BALLAST_ANIMATION } from './characters/ballast/animation.ts';
export { VOLTLING_ANIMATION } from './characters/voltling/animation.ts';
export { REED_ANIMATION } from './characters/reed/animation.ts';
export { ANIMATION_BY_CHARACTER_NAME, resolveAnimation } from './animation-registry.ts';
