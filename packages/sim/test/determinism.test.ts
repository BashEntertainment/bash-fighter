import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Sim } from '../src/sim.ts';
import { hashStateBuffer } from '../src/hash.ts';
import { buildReplayInputStream, REPLAY_SEED, REPLAY_CHARACTERS, REPLAY_SETTINGS } from './fixtures/replay-input-stream.ts';

const GOLDEN_PATH = new URL('./golden/replay-hashes.json', import.meta.url);
const golden: string[] = JSON.parse(readFileSync(GOLDEN_PATH, 'utf8'));

/**
 * Compare two long per-frame hash sequences.
 *
 * Deliberately NOT `assert.deepEqual`: these sequences are tens of thousands
 * of entries long, and on failure node:test tries to build a full structural
 * diff of both arrays. That took over ten minutes and exhausted memory on a
 * 2GB machine, turning a one-line logic bug into an apparent hang. Reporting
 * the first divergent frame is both faster and far more useful — for a
 * deterministic sim, the first divergence is the only one that matters.
 */
function assertHashSequenceEqual(actual: string[], expected: string[], label: string): void {
  assert.equal(
    actual.length,
    expected.length,
    `${label}: length mismatch (got ${actual.length}, expected ${expected.length})`,
  );
  for (let i = 0; i < actual.length; i++) {
    if (actual[i] !== expected[i]) {
      assert.fail(
        `${label}: diverged at frame ${i} of ${actual.length} ` +
          `(got ${actual[i]}, expected ${expected[i]})`,
      );
    }
  }
}

function runReplay(): string[] {
  const sim = new Sim(REPLAY_SEED, 2, REPLAY_CHARACTERS, undefined, REPLAY_SETTINGS);
  const buf = sim.createStateBuffer();
  const hashes: string[] = [];
  for (const frameInputs of buildReplayInputStream()) {
    sim.advance(frameInputs);
    sim.saveState(buf);
    hashes.push(hashStateBuffer(buf));
  }
  return hashes;
}

describe('Determinism harness', () => {
  it('replaying the recorded input stream reproduces the golden per-frame hashes exactly', () => {
    assertHashSequenceEqual(runReplay(), golden, 'replay vs golden');
  });

  it('running the same replay twice from scratch yields identical hash sequences', () => {
    assertHashSequenceEqual(runReplay(), runReplay(), 'run 1 vs run 2');
  });

  it('rollback guarantee: resuming from a saved mid-match state reproduces identical hashes to an uninterrupted run', () => {
    const inputStream = buildReplayInputStream();
    const splitPoint = 90;

    // Uninterrupted reference run.
    const reference = runReplay();

    // Run up to splitPoint, save state, keep going normally to get the
    // "continued" tail, but via a *second* Sim that we load state into —
    // simulating a rollback resync after a network correction.
    const simA = new Sim(REPLAY_SEED, 2, REPLAY_CHARACTERS, undefined, REPLAY_SETTINGS);
    const bufA = simA.createStateBuffer();
    for (let t = 0; t < splitPoint; t++) {
      simA.advance(inputStream[t] as [import('../src/types.ts').InputFrame, import('../src/types.ts').InputFrame]);
    }
    simA.saveState(bufA);

    const simB = new Sim(999999, 2, REPLAY_CHARACTERS, undefined, REPLAY_SETTINGS); // deliberately wrong seed/state first
    simB.loadState(bufA); // rollback: discard simB's own history, load A's snapshot
    const bufCheck = simB.createStateBuffer();
    const resumedHashes: string[] = [];
    for (let t = splitPoint; t < inputStream.length; t++) {
      simB.advance(inputStream[t] as [import('../src/types.ts').InputFrame, import('../src/types.ts').InputFrame]);
      simB.saveState(bufCheck);
      resumedHashes.push(hashStateBuffer(bufCheck));
    }

    const referenceTail = reference.slice(splitPoint);
    assertHashSequenceEqual(resumedHashes, referenceTail, 'resumed vs reference tail');
  });

  it('saveState/loadState round trip preserves hash at the exact save point', () => {
    const sim = new Sim(REPLAY_SEED, 2, REPLAY_CHARACTERS, undefined, REPLAY_SETTINGS);
    const buf = sim.createStateBuffer();
    for (const frameInputs of buildReplayInputStream().slice(0, 45)) {
      sim.advance(frameInputs);
    }
    sim.saveState(buf);
    const hashBefore = hashStateBuffer(buf);

    const buf2 = sim.createStateBuffer();
    sim.loadState(buf);
    sim.saveState(buf2);
    assert.equal(hashStateBuffer(buf2), hashBefore);
  });
});

// Timed Brawl (2026-09-11): same golden-hash protection as the stocks
// fixture above, but exercising 'timedKO' specifically -- respawns and
// the time-limit match end are new state-machine paths that the stocks
// fixture never touches.
import { buildReplayInputStreamTimed, REPLAY_TIMED_SEED, REPLAY_TIMED_CHARACTERS, REPLAY_TIMED_SETTINGS } from './fixtures/replay-input-stream-timed.ts';
const GOLDEN_TIMED_PATH = new URL('./golden/replay-hashes-timed.json', import.meta.url);
const goldenTimed: string[] = JSON.parse(readFileSync(GOLDEN_TIMED_PATH, 'utf8'));

function runReplayTimed(): string[] {
  const sim = new Sim(REPLAY_TIMED_SEED, 2, REPLAY_TIMED_CHARACTERS, undefined, REPLAY_TIMED_SETTINGS);
  const buf = sim.createStateBuffer();
  const hashes: string[] = [];
  for (const frameInputs of buildReplayInputStreamTimed()) {
    sim.advance(frameInputs);
    sim.saveState(buf);
    hashes.push(hashStateBuffer(buf));
  }
  return hashes;
}

describe('Determinism harness: timedKO (Timed Brawl)', () => {
  it('replaying the recorded timedKO input stream reproduces the golden per-frame hashes exactly', () => {
    assertHashSequenceEqual(runReplayTimed(), goldenTimed, 'timed replay vs golden');
  });

  it('running the same timedKO replay twice from scratch yields identical hash sequences', () => {
    assertHashSequenceEqual(runReplayTimed(), runReplayTimed(), 'timed run 1 vs run 2');
  });
});
