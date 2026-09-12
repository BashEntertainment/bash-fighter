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
import { resolveArenaId } from './arenas.ts';
import { BASH_FIGHTER_ITEM_SET } from './items/data.ts';
import { BASH_FIGHTER_HAZARD } from './hazards/data.ts';

// arenaId is a wire-level string (see resolveArenaId / packages/content's
// stage registry), never an ArenaData object: the server decides which
// stage a match plays on and tells every client its id in
// MatchStartMessage.arenaId, and *this* is the one place that id turns
// into the actual platform/blast/spawn geometry both sides build their Sim
// from. Passing the same id here on the server and on every client is what
// keeps the two Sims identical from tick zero -- see this file's top
// comment. Defaults to the original stage for any caller (including old
// recorded fixtures) that predates stage selection.
//
// `characters` is REQUIRED, deliberately, with no default (diagnosed
// 2026-09-11, see docs/MEASUREMENT.md). packages/sim's raw `Sim`
// constructor treats a missing `characters` argument as "give every seat
// the moveless DEFAULT_CHARACTER stub" -- a reasonable default *inside*
// packages/sim, where it lets physics-only unit tests build a Sim without
// depending on packages/content, but it produced silently meaningless,
// plausible-looking combat numbers (0% knockout, matches decided entirely
// by the ring, ~6x slower) in every offline harness that used this
// builder without realizing the omitted argument mattered. Every real
// caller -- server, client, and any script that wants numbers comparable
// to production -- already knows which characters it wants (resolved via
// resolveCharacterId, or drawn the way server/src/rooms.ts's bot-fill
// timer draws them for scripts; see scripts/lib/bot-character-assignment.mjs).
// Making this mandatory here, rather than defaulting it to a second,
// mirrored draw implementation living in this package, means there is
// still exactly one place that decides "which characters do bots get in a
// real match" -- server/src/rooms.ts -- and no silent fallback for
// createMatchSim callers to accidentally rely on instead of it. A caller
// that genuinely wants the moveless stub (rare, and almost certainly a
// physics-only test) should use packages/sim's `Sim` constructor directly,
// where that default is explicit, package-internal, and documented at its
// own definition.
export function createMatchSim(
  seed: number | bigint,
  numFighters: number,
  settings: Partial<MatchSettings> = {},
  characters: readonly CharacterData[],
  arenaId?: string | null,
): Sim {
  if (characters.length !== numFighters) {
    throw new RangeError(
      `createMatchSim: expected ${numFighters} character entries, got ${characters.length}`,
    );
  }
  return new Sim(
    seed,
    numFighters,
    characters,
    resolveArenaId(arenaId),
    settings,
    BASH_FIGHTER_ITEM_SET,
    BASH_FIGHTER_HAZARD,
  );
}
