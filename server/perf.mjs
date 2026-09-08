// One-off measurement script (not a test): CPU time per tick at 20
// fighters, and wire bytes/sec at 20 players for input+snapshot traffic.
// Run with: node --experimental-strip-types server/perf.mjs
import { Sim, makeInputFrame } from '../packages/sim/src/index.ts';
import { BATTLE_ROYALE_20_ARENA } from '../packages/content/src/index.ts';
import { encodeInput, encodeSnapshot, INPUT_FRAME_BYTES, SNAPSHOT_HZ } from '../packages/net/src/protocol.ts';

const N = 20;
const sim = new Sim(12345, N, undefined, BATTLE_ROYALE_20_ARENA);
const inputs = Array.from({ length: N }, () => makeInputFrame());

const TICKS = 3000; // 50 seconds of simulated match at 60Hz
const start = process.hrtime.bigint();
for (let t = 0; t < TICKS; t++) {
  // vary input a little so branches representative of real play are hit
  for (let i = 0; i < N; i++) {
    inputs[i] = { ...inputs[i], stickX: ((t + i) % 120 < 60) ? 65536 : -65536 };
  }
  sim.advance(inputs);
}
const end = process.hrtime.bigint();
const totalMs = Number(end - start) / 1e6;
const perTickUs = (totalMs * 1000) / TICKS;
console.log(`20-fighter sim.advance(): ${totalMs.toFixed(1)}ms for ${TICKS} ticks -> ${perTickUs.toFixed(2)}us/tick average`);

// Bandwidth: one input frame per player per tick (worst case, 60Hz upload),
// one snapshot broadcast to every player+spectator at SNAPSHOT_HZ.
const buf = sim.createStateBuffer();
sim.saveState(buf);
const snapshotBytes = encodeSnapshot({ tick: 1, ackedInputTick: 1, state: buf }).byteLength;
const inputBytesPerPlayerPerSec = INPUT_FRAME_BYTES * 60;
const snapshotBytesPerPlayerPerSec = snapshotBytes * SNAPSHOT_HZ;
console.log(`state buffer: ${buf.length} i32 words -> snapshot frame ${snapshotBytes} bytes`);
console.log(`per player upload (60Hz input): ${inputBytesPerPlayerPerSec} B/s`);
console.log(`per player download (${SNAPSHOT_HZ}Hz snapshot, full-state, no delta compression yet): ${snapshotBytesPerPlayerPerSec} B/s`);
console.log(`server egress at 20 players in one match: ${(snapshotBytesPerPlayerPerSec * N / 1024).toFixed(1)} KB/s`);
console.log(`server ingress at 20 players in one match: ${(inputBytesPerPlayerPerSec * N / 1024).toFixed(1)} KB/s`);

const ticksPerSecondCapacity = 1e6 / perTickUs;
const matchesPerCore = ticksPerSecondCapacity / 60; // need to sustain 60 ticks/sec per match
console.log(`estimated max concurrent 20p matches per vCPU (CPU-bound, ignoring network/GC headroom): ${matchesPerCore.toFixed(1)}`);
