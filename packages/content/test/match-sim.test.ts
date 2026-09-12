// Regression test for the harness bug diagnosed 2026-09-11 (see
// docs/MEASUREMENT.md): every offline metrics harness built its Sim via
// createMatchSim with `characters` omitted, which packages/sim's raw Sim
// constructor silently resolves to the moveless DEFAULT_CHARACTER stub for
// every seat -- a match that looks completely normal (bots move, take
// damage, get knocked around) but where no fighter can ever land an
// attack. That produced ~0% knockout / ~100% ring eliminations offline for
// years while production ran ~72% knockout, and nothing failed loudly.
//
// This is the test that would have caught it on day one: it builds a real
// match the sanctioned way and asserts every fighter that went into it
// actually has at least one move. It is deliberately generic (it does not
// special-case "the default"), so it also catches any future character
// data, real or accidental, that ships with an empty moveset.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createMatchSim } from '../src/match-sim.ts';
import { ALL_CHARACTERS } from '../src/characters.ts';

const N = 20;

function drawCharacters(seed: number, numFighters: number) {
  return Array.from(
    { length: numFighters },
    (_, i) => ALL_CHARACTERS[(i + seed) % ALL_CHARACTERS.length]!.character,
  );
}

describe('createMatchSim always builds fighters that can attack', () => {
  it('every character used to build a real match has a non-empty moveset', () => {
    const seed = 4242;
    const characters = drawCharacters(seed, N);
    // Construction itself must succeed -- createMatchSim must accept a
    // real, fully-specified roster without complaint.
    createMatchSim(seed, N, {}, characters, 'battle-royale-20');
    for (let i = 0; i < characters.length; i++) {
      const character = characters[i]!;
      assert.ok(
        character.moves.length > 0,
        `fighter ${i} (${character.name}) has an empty moveset -- it can ` +
          'never land an attack, which is exactly the bug that made offline ' +
          'metrics report ~0% knockout eliminations. See docs/MEASUREMENT.md.',
      );
    }
  });

  it('rejects a characters array of the wrong length rather than silently defaulting', () => {
    const seed = 1;
    const tooFew = drawCharacters(seed, N - 1);
    assert.throws(() => createMatchSim(seed, N, {}, tooFew, 'battle-royale-20'), RangeError);
  });

});

// Type-only check, never called at runtime: createMatchSim's `characters`
// parameter must be mandatory. If someone loosens the signature back to
// optional, this line stops producing a type error and `npm run
// typecheck` fails on the unused @ts-expect-error directive.
function _typeCheckCharactersIsMandatory() {
  // @ts-expect-error -- characters is mandatory; passing none must not compile.
  createMatchSim(1, 2, {}, undefined, 'battle-royale-20');
}
void _typeCheckCharactersIsMandatory;
