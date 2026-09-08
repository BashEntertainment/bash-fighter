// Extended 20-real-WebSocket-client load test for the authoritative match
// server, built on the pattern of scripts/load-test-20p.mjs, adding the
// measurements needed for a full production capacity write-up:
//   - server tick-timing (mean/p99/max, via /api/metrics) instead of a
//     synthetic bench, sampled through a real 20-player match
//   - bandwidth bucketed into 10s windows with alive-count per window, so
//     "peak" (all 20 alive) vs "late-match" (few alive, rest spectating)
//     can be read off directly instead of inferred
//   - round-trip latency: time from an input frame being sent to a
//     snapshot acking that input tick arriving back at the same client
//   - server RSS/CPU sampled throughout (same /proc technique as before)
// Usage: node --experimental-strip-types scripts/load-test-metrics.mjs
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { WebSocket } from 'ws';
import { hashStateBuffer } from '@bash-fighter/sim/src/hash.ts';
import { PROTOCOL_VERSION, BinaryTag, decodeSnapshot, encodeInput } from '@bash-fighter/net/src/protocol.ts';

const PORT = 8198;
const NUM_CLIENTS = 20;

function waitForHealth(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      fetch(`http://localhost:${port}/api/health`)
        .then(() => resolve())
        .catch(() => {
          if (Date.now() > deadline) reject(new Error('server did not come up in time'));
          else setTimeout(tryOnce, 100);
        });
    };
    tryOnce();
  });
}

function readProcStat(pid) {
  try {
    const statm = readFileSync(`/proc/${pid}/statm`, 'utf8').split(' ');
    const rssPages = Number(statm[1]);
    const pageSizeKb = 4;
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
    const afterComm = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
    const utime = Number(afterComm[11]);
    const stime = Number(afterComm[12]);
    return { rssKb: rssPages * pageSizeKb, utimeTicks: utime, stimeTicks: stime };
  } catch {
    return null;
  }
}

async function main() {
  const serverProc = spawn(
    process.execPath,
    ['--experimental-strip-types', new URL('../server/src/index.ts', import.meta.url).pathname],
    {
      env: {
        ...process.env,
        PORT: String(PORT),
        MATCH_CAPACITY: String(NUM_CLIENTS),
        MATCH_MINIMUM: String(NUM_CLIENTS),
        MATCH_COUNTDOWN_SECONDS: '1',
        MATCH_BOT_FILL_SECONDS: '999999',
        ...(process.env.MATCH_SHRINK_FULLY_CLOSED_TICK
          ? { MATCH_SHRINK_FULLY_CLOSED_TICK: process.env.MATCH_SHRINK_FULLY_CLOSED_TICK }
          : {}),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  let serverLog = '';
  serverProc.stdout.on('data', (d) => (serverLog += d.toString()));
  serverProc.stderr.on('data', (d) => (serverLog += d.toString()));

  const rssCpuSamples = [];
  const tickMetricSamples = [];
  const hz = 100;
  const sampleInterval = setInterval(async () => {
    const s = readProcStat(serverProc.pid);
    if (s) rssCpuSamples.push({ t: Date.now(), ...s });
    try {
      const m = await fetch(`http://localhost:${PORT}/api/metrics`).then((r) => r.json());
      tickMetricSamples.push({ t: Date.now(), ...m });
    } catch {}
  }, 2000);

  const clients = [];
  let bytesUp = 0;
  let bytesDown = 0;
  let msgsUp = 0;
  let msgsDown = 0;
  let aliveCount = NUM_CLIENTS;
  const eliminatedSlots = new Set();
  const bandwidthBuckets = new Map(); // bucketIdx(10s) -> {up, down, aliveAtStart}
  const rttSamplesMs = [];
  const startMarker = { t0: 0 };

  function bucketFor(t) {
    const idx = Math.floor((t - startMarker.t0) / 10000);
    if (!bandwidthBuckets.has(idx)) bandwidthBuckets.set(idx, { up: 0, down: 0, alive: aliveCount });
    return bandwidthBuckets.get(idx);
  }

  try {
    await waitForHealth(PORT, 20000);
    console.log('server up, connecting', NUM_CLIENTS, 'clients...');

    const connectPromises = [];
    for (let i = 0; i < NUM_CLIENTS; i++) {
      const ws = new WebSocket(`ws://localhost:${PORT}/socket`);
      const cstate = { ws, slot: -1, matchEnded: false, lastState: null, tick: 0, snapshotCount: 0, pendingSends: new Map() };
      clients.push(cstate);
      const p = new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`client ${i} never got welcome`)), 15000);
        ws.on('open', () => {
          const helloMsg = JSON.stringify({ t: 'hello', protocolVersion: PROTOCOL_VERSION, name: `LoadBot${i}` });
          const n = Buffer.byteLength(helloMsg);
          bytesUp += n;
          if (startMarker.t0) bucketFor(Date.now()).up += n;
          ws.send(helloMsg);
        });
        ws.on('message', (data, isBinary) => {
          const now = Date.now();
          if (!isBinary) {
            bytesDown += Buffer.byteLength(data);
            if (startMarker.t0) bucketFor(now).down += Buffer.byteLength(data);
            const msg = JSON.parse(data.toString());
            if (msg.t === 'welcome') {
              cstate.slot = msg.slot;
              clearTimeout(timer);
              resolve();
            }
            if (msg.t === 'matchEnd') cstate.matchEnded = true;
            if (msg.t === 'eliminated') {
              if (!eliminatedSlots.has(msg.slot)) {
                eliminatedSlots.add(msg.slot);
                aliveCount = Math.max(0, NUM_CLIENTS - eliminatedSlots.size);
              }
            }
            if (msg.t === 'error') console.error(`client ${i} error:`, msg);
          } else {
            const buf = data;
            bytesDown += buf.length;
            if (startMarker.t0) bucketFor(now).down += buf.length;
            msgsDown++;
            if (buf[0] === BinaryTag.SNAPSHOT) {
              const snap = decodeSnapshot(new Uint8Array(buf));
              if (snap) {
                cstate.lastState = snap.state;
                cstate.tick = snap.tick;
                cstate.snapshotCount++;
                // RTT: find the send timestamp for the input tick this
                // snapshot just acknowledged, if we still have it recorded.
                const sendT = cstate.pendingSends.get(snap.ackedInputTick);
                if (sendT !== undefined) {
                  rttSamplesMs.push(now - sendT);
                  // Clean up everything at or before this tick -- acked.
                  for (const k of cstate.pendingSends.keys()) {
                    if (k <= snap.ackedInputTick) cstate.pendingSends.delete(k);
                  }
                }
              }
            }
          }
        });
        ws.on('error', reject);
      });
      connectPromises.push(p);
    }

    await Promise.all(connectPromises);
    console.log('all clients joined; slots:', clients.map((c) => c.slot).sort((a, b) => a - b).join(','));
    startMarker.t0 = Date.now();

    let inputTick = 0;
    const ATTACK_BUTTON = 1;
    const inputInterval = setInterval(() => {
      inputTick++;
      const now = Date.now();
      for (const c of clients) {
        if (c.ws.readyState !== WebSocket.OPEN) continue;
        const phase = (inputTick + c.slot * 7) % 90;
        const angle = (phase / 90) * Math.PI * 2;
        const stickX = Math.round(Math.cos(angle) * 65536);
        const stickY = Math.round(Math.sin(angle) * 65536);
        const buttons = phase % 15 === 0 ? ATTACK_BUTTON : 0;
        const bytes = encodeInput({ tick: inputTick, buttons, stickX, stickY });
        bytesUp += bytes.length;
        bucketFor(now).up += bytes.length;
        msgsUp++;
        c.pendingSends.set(inputTick, now);
        // Bound memory: an unacked entry older than 5s is abandoned.
        if (c.pendingSends.size > 300) {
          const oldestAllowed = inputTick - 150;
          for (const k of c.pendingSends.keys()) if (k < oldestAllowed) c.pendingSends.delete(k);
        }
        c.ws.send(bytes);
      }
    }, 33);

    const start = Date.now();
    const maxWaitMs = 75_000;
    while (!clients.every((c) => c.matchEnded)) {
      if (Date.now() - start > maxWaitMs) break;
      await new Promise((r) => setTimeout(r, 500));
    }
    clearInterval(inputInterval);
    const durationMs = Date.now() - start;

    const allEnded = clients.every((c) => c.matchEnded);
    console.log(`match ${allEnded ? 'ended cleanly' : 'DID NOT END within ' + maxWaitMs + 'ms'} after ${durationMs}ms`);

    const withState = clients.filter((c) => c.lastState !== null);
    const hashes = withState.map((c) => hashStateBuffer(c.lastState));
    const first = hashes[0];
    let allMatch = true;
    for (let i = 1; i < hashes.length; i++) {
      if (hashes[i] !== first) allMatch = false;
    }
    console.log('all final state hashes match:', allMatch, `(${hashes.length} clients compared)`);

    for (const c of clients) c.ws.close();
    await new Promise((r) => setTimeout(r, 300));

    clearInterval(sampleInterval);
    const finalSample = readProcStat(serverProc.pid);
    if (finalSample) rssCpuSamples.push({ t: Date.now(), ...finalSample });
    let finalMetrics;
    try {
      finalMetrics = await fetch(`http://localhost:${PORT}/api/metrics`).then((r) => r.json());
    } catch {}

    console.log('\n--- server tick timing (real match, via /api/metrics) ---');
    if (finalMetrics) {
      console.log(`samples=${finalMetrics.sampleCount} mean=${finalMetrics.meanMs.toFixed(3)}ms p99=${finalMetrics.p99Ms.toFixed(3)}ms max=${finalMetrics.maxMs.toFixed(3)}ms budget=${finalMetrics.frameBudgetMs.toFixed(2)}ms`);
      console.log(`mean = ${((finalMetrics.meanMs / finalMetrics.frameBudgetMs) * 100).toFixed(2)}% of frame budget, worst-case = ${((finalMetrics.maxMs / finalMetrics.frameBudgetMs) * 100).toFixed(2)}% of frame budget`);
    }

    console.log('\n--- RSS/CPU ---');
    if (rssCpuSamples.length >= 2) {
      const f = rssCpuSamples[0], l = rssCpuSamples[rssCpuSamples.length - 1];
      const wallS = (l.t - f.t) / 1000;
      const cpuS = ((l.utimeTicks + l.stimeTicks) - (f.utimeTicks + f.stimeTicks)) / hz;
      console.log(`over ${wallS.toFixed(1)}s wall: ${cpuS.toFixed(2)}s CPU -> ${((cpuS / wallS) * 100).toFixed(1)}% of one core`);
      console.log(`RSS start ${f.rssKb}KB end ${l.rssKb}KB peak ${Math.max(...rssCpuSamples.map(s=>s.rssKb))}KB`);
    }

    console.log('\n--- bandwidth by 10s window (bytes/s per client alive at window start) ---');
    console.log('window_s\talive\tup_Bps_total\tdown_Bps_total\tdown_Bps_per_client');
    const sortedBuckets = [...bandwidthBuckets.entries()].sort((a, b) => a[0] - b[0]);
    for (const [idx, b] of sortedBuckets) {
      console.log(`${idx * 10}\t${b.alive}\t${(b.up / 10).toFixed(0)}\t${(b.down / 10).toFixed(0)}\t${(b.down / 10 / Math.max(1,b.alive)).toFixed(0)}`);
    }

    console.log('\n--- RTT (input send -> ack in snapshot) ---');
    if (rttSamplesMs.length > 0) {
      const sorted = [...rttSamplesMs].sort((a, b) => a - b);
      const mean = sorted.reduce((a, b) => a + b, 0) / sorted.length;
      const p50 = sorted[Math.floor(sorted.length * 0.5)];
      const p99 = sorted[Math.floor(sorted.length * 0.99)];
      console.log(`n=${sorted.length} mean=${mean.toFixed(1)}ms p50=${p50}ms p99=${p99}ms max=${sorted[sorted.length-1]}ms min=${sorted[0]}ms`);
    } else {
      console.log('no RTT samples captured');
    }

    console.log('\n--- totals ---');
    console.log(`upload: ${msgsUp} msgs, ${bytesUp} bytes -> ${(bytesUp/(durationMs/1000)/1024).toFixed(1)} KB/s total`);
    console.log(`download: ${msgsDown} msgs, ${bytesDown} bytes -> ${(bytesDown/(durationMs/1000)/1024).toFixed(1)} KB/s total, ${(bytesDown/NUM_CLIENTS/(durationMs/1000)).toFixed(0)} B/s/client avg`);

    process.exitCode = allEnded && allMatch ? 0 : 1;
  } catch (err) {
    console.error('LOAD TEST FAILED:', err);
    console.error('server log so far:\n', serverLog);
    process.exitCode = 1;
  } finally {
    clearInterval(sampleInterval);
    serverProc.kill();
  }
}

main();
