// One place that builds the match simulation.
//
// The server and every client each run their own Sim: the server's is
// authoritative, and each client runs an identical copy to predict its own
// fighter between snapshots. "Identical" is load-bearing. Arena, item set and
// hazard config are *configuration*, not transferable state — a Sim that is
// handed a snapshot via loadState but was constructed with a different arena
// diverges on the very next tick, and it does so silently, with no error
// anywhere. That is the worst bug class this codebase has.
//
// So neither side is allowed to construct a Sim by hand. Both call this.
import { Sim, type MatchSettings } from '@bash-fighter/sim';
import type { CharacterData } from '@bash-fighter/sim';
import { BATTLE_ROYALE_20_ARENA } from './arenas/battle-royale-20/data.ts';
import { BASH_FIGHTER_ITEM_SET } from './items/data.ts';
import { BASH_FIGHTER_HAZARD } from './hazards/data.ts';

export function createMatchSim(
  seed: number | bigint,
  numFighters: number,
  settings: Partial<MatchSettings> = {},
  characters?: readonly CharacterData[],
): Sim {
  return new Sim(
    seed,
    numFighters,
    characters,
    BATTLE_ROYALE_20_ARENA,
    settings,
    BASH_FIGHTER_ITEM_SET,
    BASH_FIGHTER_HAZARD,
  );
}
