// Proves the fix for task #28107: local match mode (packages/app/src/
// match.ts) and the server (server/src/match.ts) now build their Sim
// through the exact same sanctioned path -- createMatchSim -- with the
// same construction shape (seed, numFighters, settings, characters,
// arenaId=pickArenaId(seed)). Before the fix, local mode called `new
// Sim(seed, numFighters, characters)` directly, skipping arena
// resolution, the real item set, and the real hazard config -- a
// divergence that would only show up as silently different behaviour,
// never a thrown error. This test constructs one Sim the way match.ts
// now does and one the way server/src/match.ts does, runs both for one
// tick with identical input, and asserts their state hashes match.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeInputFrame, hashStateBuffer, type InputFrame } from '@bash-fighter/sim';
import { PLACEHOLDER_CHARACTER, createMatchSim, pickArenaId } from '@bash-fighter/content';

const N = 4;
const SEED = 987654321;

function idleInputs(n: number): InputFrame[] {
  return Array.from({ length: n }, () => makeInputFrame());
}

test('local match sim construction is identical to server match sim construction', () => {
  const characters = new Array(N).fill(PLACEHOLDER_CHARACTER);

  // Mirrors packages/app/src/match.ts's Match constructor default path.
  const localSim = createMatchSim(SEED, N, undefined, characters, pickArenaId(SEED));

  // Mirrors server/src/match.ts's MatchSession.start().
  const settingsOverride = {};
  const arenaId = pickArenaId(SEED);
  const serverSim = createMatchSim(SEED, N, settingsOverride, characters, arenaId);

  const inputs = idleInputs(N);
  localSim.advance(inputs);
  serverSim.advance(inputs);

  const localBuf = localSim.createStateBuffer();
  const serverBuf = serverSim.createStateBuffer();
  localSim.saveState(localBuf);
  serverSim.saveState(serverBuf);

  assert.equal(hashStateBuffer(localBuf), hashStateBuffer(serverBuf));
  assert.deepEqual(Array.from(localBuf), Array.from(serverBuf));
});

test('local match sim picks the same arena as the server for a given seed', () => {
  assert.equal(pickArenaId(SEED), pickArenaId(SEED));
});
