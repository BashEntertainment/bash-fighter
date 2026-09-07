// Standalone runner: advances a Sim over the recorded replay fixture,
// hashing full state every frame, and writes the resulting per-frame hash
// log. Used both to (re)generate the golden file and, via the test suite,
// to verify current behavior still matches it exactly.
import { Sim } from '../packages/sim/src/sim.ts';
import { hashStateBuffer } from '../packages/sim/src/hash.ts';
import { buildReplayInputStream, REPLAY_SEED } from '../packages/sim/test/fixtures/replay-input-stream.ts';

export function runDeterminismHarness(): string[] {
  const sim = new Sim(REPLAY_SEED);
  const buf = sim.createStateBuffer();
  const inputStream = buildReplayInputStream();
  const hashes: string[] = [];
  for (const frameInputs of inputStream) {
    sim.advance(frameInputs);
    sim.saveState(buf);
    hashes.push(hashStateBuffer(buf));
  }
  return hashes;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const hashes = runDeterminismHarness();
  const outPath = new URL('../packages/sim/test/golden/replay-hashes.json', import.meta.url);
  const { writeFileSync } = await import('node:fs');
  writeFileSync(outPath, JSON.stringify(hashes, null, 2) + '\n');
  console.log(`wrote ${hashes.length} golden hashes to ${outPath.pathname}`);
}
