// Character/stage TypeScript data modules + schema validator (Engine
// Architecture part 2 section 7). packages/render, packages/net and
// packages/app are still out of scope stubs; this package now provides
// real content: the placeholder character and a validator a contributor's
// PR runs before merge.
export * from './validate.ts';
export { PLACEHOLDER_CHARACTER } from './characters/placeholder/data.ts';
export { BATTLE_ROYALE_20_ARENA } from './arenas/battle-royale-20/data.ts';
export { BASH_FIGHTER_ITEM_SET } from './items/data.ts';
export { BASH_FIGHTER_HAZARD } from './hazards/data.ts';
export { createMatchSim } from './match-sim.ts';
