// N=20 golden-hash fixture (this task's item: "add a golden-hash fixture
// test at N=20 fighters"). Mirrors determinism.test.ts's pattern but at
// battle-royale scale: pins that a fresh Sim replaying the recorded
// 20-fighter input stream reproduces the exact same per-tick state hash
// sequence every time. Deliberately compares hashes only (never the raw
// state arrays) and keeps the fixture to 600 ticks — see
// assertHashSequenceEqual's comment in determinism.test.ts for why a
// large deepEqual OOM'd this container before.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Sim } from '../src/sim.ts';
import { hashStateBuffer } from '../src/hash.ts';
import {
  buildReplayInputStream20,
  REPLAY_20_SEED,
  REPLAY_20_N,
  REPLAY_20_CHARACTERS,
  REPLAY_20_ARENA,
  REPLAY_20_SETTINGS,
} from './fixtures/replay-input-stream-20.ts';

const GOLDEN_PATH = new URL('./golden/replay-hashes-20.json', import.meta.url);
const golden: string[] = JSON.parse(readFileSync(GOLDEN_PATH, 'utf8'));

function assertHashSequenceEqual(actual: string[], expected: string[], label: string): void {
  assert.equal(
    actual.length,
    expected.length,
    `${label}: length mismatch (got ${actual.length}, expected ${expected.length})`,
  );
  for (let i = 0; i < actual.length; i++) {
    if (actual[i] !== expected[i]) {
      assert.fail(
        `${label}: diverged at frame ${i} of ${actual.length} (got ${actual[i]}, expected ${expected[i]})`,
      );
    }
  }
}

function runReplay20(): string[] {
  const sim = new Sim(REPLAY_20_SEED, REPLAY_20_N, REPLAY_20_CHARACTERS, REPLAY_20_ARENA, REPLAY_20_SETTINGS);
  const buf = sim.createStateBuffer();
  const hashes: string[] = [];
  for (const frameInputs of buildReplayInputStream20()) {
    sim.advance(frameInputs);
    sim.saveState(buf);
    hashes.push(hashStateBuffer(buf));
  }
  return hashes;
}

describe('Determinism harness (N=20 battle royale)', () => {
  it('replaying the recorded 20-fighter input stream reproduces the golden per-frame hashes exactly', () => {
    assertHashSequenceEqual(runReplay20(), golden, 'replay20 vs golden');
  });

  it('running the same 20-fighter replay twice from scratch yields identical hash sequences', () => {
    assertHashSequenceEqual(runReplay20(), runReplay20(), 'run1 vs run2');
  });

});
