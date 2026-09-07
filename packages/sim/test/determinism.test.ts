import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Sim } from '../src/sim.ts';
import { hashStateBuffer } from '../src/hash.ts';
import { buildReplayInputStream, REPLAY_SEED, REPLAY_CHARACTERS } from './fixtures/replay-input-stream.ts';

const GOLDEN_PATH = new URL('./golden/replay-hashes.json', import.meta.url);
const golden: string[] = JSON.parse(readFileSync(GOLDEN_PATH, 'utf8'));

function runReplay(): string[] {
  const sim = new Sim(REPLAY_SEED, REPLAY_CHARACTERS);
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
    const hashes = runReplay();
    assert.equal(hashes.length, golden.length);
    assert.deepEqual(hashes, golden);
  });

  it('running the same replay twice from scratch yields identical hash sequences', () => {
    assert.deepEqual(runReplay(), runReplay());
  });

  it('rollback guarantee: resuming from a saved mid-match state reproduces identical hashes to an uninterrupted run', () => {
    const inputStream = buildReplayInputStream();
    const splitPoint = 90;

    // Uninterrupted reference run.
    const reference = runReplay();

    // Run up to splitPoint, save state, keep going normally to get the
    // "continued" tail, but via a *second* Sim that we load state into —
    // simulating a rollback resync after a network correction.
    const simA = new Sim(REPLAY_SEED, REPLAY_CHARACTERS);
    const bufA = simA.createStateBuffer();
    for (let t = 0; t < splitPoint; t++) {
      simA.advance(inputStream[t] as [import('../src/types.ts').InputFrame, import('../src/types.ts').InputFrame]);
    }
    simA.saveState(bufA);

    const simB = new Sim(999999, REPLAY_CHARACTERS); // deliberately wrong seed/state first
    simB.loadState(bufA); // rollback: discard simB's own history, load A's snapshot
    const bufCheck = simB.createStateBuffer();
    const resumedHashes: string[] = [];
    for (let t = splitPoint; t < inputStream.length; t++) {
      simB.advance(inputStream[t] as [import('../src/types.ts').InputFrame, import('../src/types.ts').InputFrame]);
      simB.saveState(bufCheck);
      resumedHashes.push(hashStateBuffer(bufCheck));
    }

    const referenceTail = reference.slice(splitPoint);
    assert.deepEqual(resumedHashes, referenceTail);
  });

  it('saveState/loadState round trip preserves hash at the exact save point', () => {
    const sim = new Sim(REPLAY_SEED, REPLAY_CHARACTERS);
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
