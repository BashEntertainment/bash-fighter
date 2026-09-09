// Standalone runner: (re)generates packages/sim/test/golden/replay-hashes-20.json
// from the N=20 replay fixture, mirroring run-determinism-harness.ts's
// pattern for the 2-fighter fixture. Only ever run this by hand when a
// legitimate sim- or content-affecting change (e.g. a stage's spawn point
// layout) intentionally alters the N=20 golden hashes -- never hand-edit
// the JSON.
import { Sim } from '../packages/sim/src/sim.ts';
import { hashStateBuffer } from '../packages/sim/src/hash.ts';
import {
  buildReplayInputStream20,
  REPLAY_20_SEED,
  REPLAY_20_N,
  REPLAY_20_CHARACTERS,
  REPLAY_20_ARENA,
  REPLAY_20_SETTINGS,
} from '../packages/sim/test/fixtures/replay-input-stream-20.ts';

export function runDeterminismHarness20(): string[] {
  const sim = new Sim(REPLAY_20_SEED, REPLAY_20_N, REPLAY_20_CHARACTERS, REPLAY_20_ARENA, REPLAY_20_SETTINGS);
  const buf = sim.createStateBuffer();
  const inputStream = buildReplayInputStream20();
  const hashes: string[] = [];
  for (const frameInputs of inputStream) {
    sim.advance(frameInputs);
    sim.saveState(buf);
    hashes.push(hashStateBuffer(buf));
  }
  return hashes;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const hashes = runDeterminismHarness20();
  const outPath = new URL('../packages/sim/test/golden/replay-hashes-20.json', import.meta.url);
  const { writeFileSync } = await import('node:fs');
  writeFileSync(outPath, JSON.stringify(hashes, null, 2) + '\n');
  console.log(`wrote ${hashes.length} golden hashes to ${outPath.pathname}`);
}
