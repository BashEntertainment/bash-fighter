// 20-real-WebSocket-client load test for the authoritative match server.
// Spawns the server as a child process (like server/test/integration.test.ts),
// connects 20 real WebSocket clients, drives a full battle-royale match with
// varied input (movement + attacks), and reports:
//   - server process RSS/CPU sampled periodically (via /proc, since this
//     runs in a container without a full `top`)
//   - match duration, whether it ended cleanly, and final state hash match
//     across all 20 clients (same anti-desync check as integration.test.ts)
//   - a derived bandwidth estimate from actual message counts/sizes sent
// This is a throwaway-but-reusable diagnostic; safe to re-run any time
// against a checked-out server build. Does not modify game logic.
//
// Usage: node --experimental-strip-types scripts/load-test-20p.mjs
import { spawn } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { WebSocket } from 'ws';
import { hashStateBuffer } from '@bash-fighter/sim/src/hash.ts';
import { PROTOCOL_VERSION, BinaryTag, decodeSnapshot, encodeInput } from '@bash-fighter/net/src/protocol.ts';

const PORT = 8199;
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
  // Returns { rssKb, utimeTicks, stimeTicks } from /proc/<pid>/stat + statm.
  try {
    const statm = readFileSync(`/proc/${pid}/statm`, 'utf8').split(' ');
    const rssPages = Number(statm[1]);
    const pageSizeKb = 4; // standard on this container's kernel
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
    const afterComm = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
    // fields after (2) pid,comm : utime=12, stime=13 (1-indexed from field 3 = state)
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
        MATCH_BOT_FILL_SECONDS: '999999', // never bot-fill; we bring all 20 seats ourselves
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

  const samples = [];
  const hz = 100; // USER_HZ, standard on Linux
  const sampleInterval = setInterval(() => {
    const s = readProcStat(serverProc.pid);
    if (s) samples.push({ t: Date.now(), ...s });
  }, 1000);

  const clients = [];
  let bytesUp = 0;
  let bytesDown = 0;
  let msgsUp = 0;
  let msgsDown = 0;

  try {
    await waitForHealth(PORT, 20000);
    console.log('server up, connecting', NUM_CLIENTS, 'clients...');

    const connectPromises = [];
    for (let i = 0; i < NUM_CLIENTS; i++) {
      const ws = new WebSocket(`ws://localhost:${PORT}/socket`);
      const cstate = { ws, slot: -1, matchEnded: false, lastState: null, tick: 0, snapshotCount: 0 };
      clients.push(cstate);
      const p = new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`client ${i} never got welcome`)), 15000);
        ws.on('open', () => {
          const helloMsg = JSON.stringify({ t: 'hello', protocolVersion: PROTOCOL_VERSION, name: `LoadBot${i}` });
          bytesUp += Buffer.byteLength(helloMsg);
          ws.send(helloMsg);
        });
        ws.on('message', (data, isBinary) => {
          if (!isBinary) {
            bytesDown += Buffer.byteLength(data);
            const msg = JSON.parse(data.toString());
            if (msg.t === 'welcome') {
              cstate.slot = msg.slot;
              clearTimeout(timer);
              resolve();
            }
            if (msg.t === 'matchEnd') cstate.matchEnded = true;
            if (msg.t === 'error') console.error(`client ${i} error:`, msg);
          } else {
            const buf = data;
            bytesDown += buf.length;
            msgsDown++;
            if (buf[0] === BinaryTag.SNAPSHOT) {
              const snap = decodeSnapshot(new Uint8Array(buf));
              if (snap) {
                cstate.lastState = snap.state;
                cstate.tick = snap.tick;
                cstate.snapshotCount++;
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

    // Drive varied input: movement in a per-client circular pattern plus
    // periodic attack-button presses, at 30Hz per client (realistic input
    // upload rate, matches integration.test.ts pattern but with attacks).
    let inputTick = 0;
    const ATTACK_BUTTON = 1; // bit 0, matches protocol.ts button layout for "attack"
    const inputInterval = setInterval(() => {
      inputTick++;
      for (const c of clients) {
        if (c.ws.readyState !== WebSocket.OPEN) continue;
        const phase = (inputTick + c.slot * 7) % 90;
        const angle = (phase / 90) * Math.PI * 2;
        const stickX = Math.round(Math.cos(angle) * 65536);
        const stickY = Math.round(Math.sin(angle) * 65536);
        const buttons = phase % 15 === 0 ? ATTACK_BUTTON : 0;
        const bytes = encodeInput({ tick: inputTick, buttons, stickX, stickY });
        bytesUp += bytes.length;
        msgsUp++;
        c.ws.send(bytes);
      }
    }, 33);

    const start = Date.now();
    const maxWaitMs = 90_000;
    while (!clients.every((c) => c.matchEnded)) {
      if (Date.now() - start > maxWaitMs) break;
      await new Promise((r) => setTimeout(r, 500));
    }
    clearInterval(inputInterval);
    const durationMs = Date.now() - start;

    const allEnded = clients.every((c) => c.matchEnded);
    console.log(`match ${allEnded ? 'ended cleanly' : 'DID NOT END within ' + maxWaitMs + 'ms'} after ${durationMs}ms`);

    const withState = clients.filter((c) => c.lastState !== null);
    console.log(`${withState.length}/${NUM_CLIENTS} clients received at least one snapshot`);
    const hashes = withState.map((c) => hashStateBuffer(c.lastState));
    const first = hashes[0];
    let allMatch = true;
    for (let i = 1; i < hashes.length; i++) {
      if (hashes[i] !== first) {
        allMatch = false;
        console.error(`client ${withState[i].slot} final hash ${hashes[i]} != client ${withState[0].slot} hash ${first}`);
      }
    }
    console.log('all final state hashes match:', allMatch, `(${hashes.length} clients compared, value=${first})`);
    console.log('snapshot counts per client (min/max):', Math.min(...clients.map(c=>c.snapshotCount)), Math.max(...clients.map(c=>c.snapshotCount)));

    for (const c of clients) c.ws.close();
    await new Promise((r) => setTimeout(r, 300));

    clearInterval(sampleInterval);
    const finalSample = readProcStat(serverProc.pid);
    if (finalSample) samples.push({ t: Date.now(), ...finalSample });

    console.log('\n--- resource samples (server process) ---');
    console.log('time_s\trss_kb');
    const t0 = samples[0]?.t ?? Date.now();
    for (const s of samples) console.log(`${((s.t - t0) / 1000).toFixed(1)}\t${s.rssKb}`);
    if (samples.length >= 2) {
      const first_s = samples[0];
      const last_s = samples[samples.length - 1];
      const wallS = (last_s.t - first_s.t) / 1000;
      const cpuTicks = (last_s.utimeTicks + last_s.stimeTicks) - (first_s.utimeTicks + first_s.stimeTicks);
      const cpuS = cpuTicks / hz;
      console.log(`\nover ${wallS.toFixed(1)}s wall: ${cpuS.toFixed(2)}s CPU used -> ${((cpuS / wallS) * 100).toFixed(1)}% of one core`);
      console.log(`RSS: start ${first_s.rssKb}KB, end ${last_s.rssKb}KB, peak ${Math.max(...samples.map(s=>s.rssKb))}KB`);
    }
    console.log('\n--- bandwidth (actual, over the test) ---');
    console.log(`upload (client->server): ${msgsUp} msgs, ${bytesUp} bytes total, avg ${(bytesUp/msgsUp).toFixed(1)}B/msg`);
    console.log(`download (server->clients, all ${NUM_CLIENTS} combined): ${msgsDown} msgs, ${bytesDown} bytes total`);
    console.log(`implied per-connection download rate: ${(bytesDown / NUM_CLIENTS / (durationMs/1000)).toFixed(0)} B/s`);
    console.log(`implied total server egress: ${(bytesDown / (durationMs/1000) / 1024).toFixed(1)} KB/s`);
    console.log(`implied total server ingress: ${(bytesUp / (durationMs/1000) / 1024).toFixed(1)} KB/s`);

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
