// One-off measurement script (not a test, mirrors server/perf.mjs in spirit):
// cost per tick of sim.advance() -- dominated by the deterministic broad-phase
// grid (packages/sim/src/broadphase.ts) rebuild + candidate-pair query that
// runs once per tick per attacking hitbox -- at N=2, 8, 20, and 32 fighters.
//
// Run with: node --experimental-strip-types packages/sim/bench/broadphase-scaling.mjs
// Findings recorded in the wiki (see "Netplay Implementation and Measured
// Performance").
import { Sim, makeInputFrame } from '../src/index.ts';
import { BATTLE_ROYALE_20_ARENA } from '../../content/src/index.ts';

const TICKS = 5000;

function bench(n) {
  const sim = new Sim(12345, n, undefined, BATTLE_ROYALE_20_ARENA);
  const inputs = Array.from({ length: n }, () => makeInputFrame());
  // Warm up JIT before timing, same approach as server/perf.mjs.
  for (let t = 0; t < 1000; t++) {
    for (let i = 0; i < n; i++) {
      inputs[i] = { ...inputs[i], stickX: ((t + i) % 120 < 60) ? 65536 : -65536, attack: (t + i) % 30 === 0 };
    }
    sim.advance(inputs);
  }
  const start = process.hrtime.bigint();
  for (let t = 0; t < TICKS; t++) {
    for (let i = 0; i < n; i++) {
      inputs[i] = { ...inputs[i], stickX: ((t + i) % 120 < 60) ? 65536 : -65536, attack: (t + i) % 30 === 0 };
    }
    sim.advance(inputs);
  }
  const end = process.hrtime.bigint();
  const totalMs = Number(end - start) / 1e6;
  const perTickUs = (totalMs * 1000) / TICKS;
  return { n, totalMs, perTickUs };
}

console.log('N   total_ms(2000 ticks)   us/tick');
for (const n of [2, 8, 20, 32]) {
  const r = bench(n);
  console.log(`${String(r.n).padEnd(3)} ${r.totalMs.toFixed(1).padStart(18)}   ${r.perTickUs.toFixed(2)}`);
}
