// Mirrors server/src/rooms.ts's startBotFillTimer character assignment
// exactly, so offline harnesses build the same per-seat CharacterData the
// real server does instead of silently falling back to packages/sim's
// internal DEFAULT_CHARACTER (moves: [] -- a no-op attack stub meant for
// sim-core unit tests that don't care about combat, not a stand-in for a
// real roster pick). Diagnosed 2026-09-11: every pre-existing offline
// metrics harness called `new Sim(seed, N, undefined, ...)` /
// `createMatchSim(seed, N, {}, undefined, ...)`, which resolves to
// DEFAULT_CHARACTER for all 20 seats -- bots that can move and take
// damage but can never land a hit, because their attack input is a
// no-op regardless of range/timing. That is the real cause of the
// harness-vs-production gap in docs/MEASUREMENT.md: it looks like a
// timing/tuning problem but is actually "the bots offline are unarmed."
//
// Human seats in production keep whatever characterId they requested,
// or fall back to resolveCharacterId's default (PLACEHOLDER_CHARACTER)
// if unset -- see packages/content/src/characters.ts. Bot seats get a
// character deterministically drawn from ALL_CHARACTERS, seeded from
// (matchSeed ^ (slot * 0x9e3779b9)), never Math.random -- see
// server/src/rooms.ts's startBotFillTimer for the source of truth this
// mirrors.
import { seedRng, nextBounded } from '../../packages/sim/src/math/prng.ts';
import { ALL_CHARACTERS } from '../../packages/content/src/characters.ts';

/** Returns an array of CharacterData, one per seat 0..numFighters-1,
 *  reproducing production's real per-match roster exactly:
 *   - seats in `humanSlots` get PLACEHOLDER_CHARACTER (the same fallback
 *     resolveCharacterId gives an unset/human characterId).
 *   - every other seat (a bot seat) gets the same seeded ALL_CHARACTERS
 *     draw server/src/rooms.ts's startBotFillTimer performs for that
 *     slot, given the same matchSeed. */
export function assignServerCharacters(matchSeed, numFighters, humanSlots = new Set()) {
  const characters = [];
  for (let slot = 0; slot < numFighters; slot++) {
    if (humanSlots.has(slot)) {
      characters.push(ALL_CHARACTERS.find((c) => c.id === 'placeholder').character);
      continue;
    }
    const rng = seedRng((matchSeed ^ (slot * 0x9e3779b9)) >>> 0);
    const draw = nextBounded(rng, ALL_CHARACTERS.length);
    characters.push(ALL_CHARACTERS[draw.value].character);
  }
  return characters;
}
