// One-off helper to regenerate the golden per-frame hash fixtures after a
// legitimate gameplay change (never edit the golden JSON files by hand).
// Run via: node --experimental-strip-types scripts/regen-golden.mjs
import { writeFileSync } from 'node:fs';
import { Sim } from '../packages/sim/src/sim.ts';
import { hashStateBuffer } from '../packages/sim/src/hash.ts';
import { buildReplayInputStream, REPLAY_SEED, REPLAY_CHARACTERS, REPLAY_SETTINGS } from '../packages/sim/test/fixtures/replay-input-stream.ts';
import { buildReplayInputStreamTimed, REPLAY_TIMED_SEED, REPLAY_TIMED_CHARACTERS, REPLAY_TIMED_SETTINGS } from '../packages/sim/test/fixtures/replay-input-stream-timed.ts';
import {
  buildReplayInputStream20,
  REPLAY_20_SEED,
  REPLAY_20_N,
  REPLAY_20_CHARACTERS,
  REPLAY_20_ARENA,
  REPLAY_20_SETTINGS,
} from '../packages/sim/test/fixtures/replay-input-stream-20.ts';

function runReplay() {
  const sim = new Sim(REPLAY_SEED, 2, REPLAY_CHARACTERS, undefined, REPLAY_SETTINGS);
  const buf = sim.createStateBuffer();
  const hashes = [];
  for (const frameInputs of buildReplayInputStream()) {
    sim.advance(frameInputs);
    sim.saveState(buf);
    hashes.push(hashStateBuffer(buf));
  }
  return hashes;
}

function runReplay20() {
  const sim = new Sim(REPLAY_20_SEED, REPLAY_20_N, REPLAY_20_CHARACTERS, REPLAY_20_ARENA, REPLAY_20_SETTINGS);
  const buf = sim.createStateBuffer();
  const hashes = [];
  for (const frameInputs of buildReplayInputStream20()) {
    sim.advance(frameInputs);
    sim.saveState(buf);
    hashes.push(hashStateBuffer(buf));
  }
  return hashes;
}

const h1 = runReplay();
const h1b = runReplay();
if (JSON.stringify(h1) !== JSON.stringify(h1b)) {
  console.error('N=2 replay non-deterministic across two runs, refusing to write golden');
  process.exit(1);
}
writeFileSync(new URL('../packages/sim/test/golden/replay-hashes.json', import.meta.url), JSON.stringify(h1));
console.log('wrote replay-hashes.json, length', h1.length);

const h2 = runReplay20();
const h2b = runReplay20();
if (JSON.stringify(h2) !== JSON.stringify(h2b)) {
  console.error('N=20 replay non-deterministic across two runs, refusing to write golden');
  process.exit(1);
}
writeFileSync(new URL('../packages/sim/test/golden/replay-hashes-20.json', import.meta.url), JSON.stringify(h2));
console.log('wrote replay-hashes-20.json, length', h2.length);

function runReplayTimed() {
  const sim = new Sim(REPLAY_TIMED_SEED, 2, REPLAY_TIMED_CHARACTERS, undefined, REPLAY_TIMED_SETTINGS);
  const buf = sim.createStateBuffer();
  const hashes = [];
  for (const frameInputs of buildReplayInputStreamTimed()) {
    sim.advance(frameInputs);
    sim.saveState(buf);
    hashes.push(hashStateBuffer(buf));
  }
  return hashes;
}

const h3 = runReplayTimed();
const h3b = runReplayTimed();
if (JSON.stringify(h3) !== JSON.stringify(h3b)) {
  console.error('timedKO replay non-deterministic across two runs, refusing to write golden');
  process.exit(1);
}
writeFileSync(new URL('../packages/sim/test/golden/replay-hashes-timed.json', import.meta.url), JSON.stringify(h3));
console.log('wrote replay-hashes-timed.json, length', h3.length);
