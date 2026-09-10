// On-box reconnect/resume divergence harness (task #28231).
//
// Mirrors the CLIENT's own reconciliation logic from packages/app/src/net-match.ts
// (localTick / inputHistory / replay-on-snapshot) against a real server, over
// loopback (no container egress proxy involved either way -- this connects
// directly to whatever --target host:port you pass).
//
// Usage:
//   node --experimental-strip-types scripts/reconnect-divergence-harness.mjs \
//        --port 8201 --cycles 5 --spawn-local
//
//   (against production, run ON THE BOX via ssh, targeting loopback):
//   node --experimental-strip-types scripts/reconnect-divergence-harness.mjs \
//        --port 8081 --cycles 5 --host 127.0.0.1
//
// For each reconnect cycle it:
//   1. connects a real client, drives it into a match
//   2. lets it play a bit (accumulating localTick + inputHistory exactly as
//      net-match.ts does)
//   3. closes the socket (raw drop, not a clean close)
//   4. reconnects with the resume token
//   5. keeps playing and, on every received snapshot, records:
//        - snap.tick (server authoritative tick)
//        - localTick (client's own prediction clock, replicated 1:1 from
//          net-match.ts's startMatch()/tick())
//        - replayWindow = localTick - snap.tick  (how many ticks the
//          reconciliation replay loop actually re-applies; net-match.ts's
//          loop is `for t = snap.tick+1; t <= localTick`, so this must stay
//          small and *positive* for prediction to do anything at all -- if
//          it goes deeply negative and stays there, client-side prediction
//          for the local fighter is silently dead for the rest of the match)
//        - the authoritative state hash (hashStateBuffer) for cross-checking
//
// Exit code 0 + summary printed either way; this does not assert/fail, it
// reports, so it can be pointed at production without any risk of it being
// mistaken for a destructive action.
import { spawn } from 'node:child_process';
import { WebSocket } from 'ws';
import { hashStateBuffer } from '../packages/sim/src/hash.ts';
import { PROTOCOL_VERSION, BinaryTag, decodeSnapshot, encodeInput } from '../packages/net/src/protocol.ts';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => {
    if (a.startsWith('--')) acc.push([a.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : 'true']);
    return acc;
  }, []),
);
const PORT = Number(args.port ?? 8201);
const HOST = args.host ?? 'localhost';
const CYCLES = Number(args.cycles ?? 5);
const SPAWN_LOCAL = args['spawn-local'] === 'true' || args['spawn-local'] === undefined ? true : args['spawn-local'] === 'true';

function waitForHealth(host, port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      fetch(`http://${host}:${port}/api/health`)
        .then(() => resolve())
        .catch(() => {
          if (Date.now() > deadline) reject(new Error('server did not come up in time'));
          else setTimeout(tryOnce, 150);
        });
    };
    tryOnce();
  });
}

function startLocalServer(port) {
  const proc = spawn(
    process.execPath,
    ['--experimental-strip-types', new URL('../server/src/index.ts', import.meta.url).pathname],
    {
      env: {
        ...process.env,
        PORT: String(port),
        MATCH_CAPACITY: '3',
        MATCH_MINIMUM: '3',
        MATCH_COUNTDOWN_SECONDS: '1',
        MATCH_SHRINK_FULLY_CLOSED_TICK: '100000',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  let log = '';
  proc.stdout.on('data', (d) => (log += d.toString()));
  proc.stderr.on('data', (d) => (log += d.toString()));
  return { proc, getLog: () => log };
}

/** A scripted client that replicates net-match.ts's reconciliation state
 *  machine (localTick, inputHistory, replay window) closely enough to
 *  observe the same divergence a real browser client would, without
 *  needing a DOM/canvas. */
class ScriptedClient {
  constructor(host, port, name) {
    this.host = host;
    this.port = port;
    this.name = name;
    this.resumeToken = null;
    this.mySlot = -1;
    this.localTick = 0; // == net-match.ts's this.localTick
    this.inputHistory = new Map();
    this.records = []; // { snapTick, localTick, replayWindow, hash }
    this.controls = [];
    this._waiters = [];
  }

  connect(fixLocalTickBug) {
    this._fix = fixLocalTickBug;
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://${this.host}:${this.port}/socket`);
      this.ws = ws;
      const timer = setTimeout(() => reject(new Error('never opened')), 20000);
      ws.on('open', () => {
        clearTimeout(timer);
        const hello = { t: 'hello', protocolVersion: PROTOCOL_VERSION, name: this.name };
        if (this.resumeToken) hello.resume = this.resumeToken;
        ws.send(JSON.stringify(hello));
        resolve();
      });
      ws.on('message', (data, isBinary) => {
        if (!isBinary) {
          const msg = JSON.parse(data.toString());
          this.controls.push(msg);
          if (msg.t === 'welcome') {
            this.mySlot = msg.slot;
            this.resumeToken = msg.resumeToken ?? this.resumeToken;
          }
          if (msg.t === 'matchStart') {
            // Exactly net-match.ts's startMatch(): resets localTick to 0
            // and clears inputHistory UNCONDITIONALLY, resume or not --
            // that is the suspected bug. With --fix, we instead only reset
            // on a true fresh start (never resumed before).
            if (!this._fix || !this._everResumed) {
              this.localTick = 0;
            }
            this.inputHistory.clear();
          }
          for (let i = this._waiters.length - 1; i >= 0; i--) {
            if (this._waiters[i].pred(msg)) {
              const [w] = this._waiters.splice(i, 1);
              w.resolve(msg);
            }
          }
        } else {
          const buf = data;
          if (buf[0] === BinaryTag.SNAPSHOT) {
            const snap = decodeSnapshot(new Uint8Array(buf));
            if (!snap) return;
            // Replicate handleBinary's reconciliation bookkeeping.
            for (const t of Array.from(this.inputHistory.keys())) {
              if (t <= snap.ackedInputTick) this.inputHistory.delete(t);
            }
            if (this._fix && snap.tick > this.localTick) {
              // The candidate fix: resync the prediction clock forward to
              // the authoritative tick instead of leaving it stranded.
              this.localTick = snap.tick;
            }
            const replayWindow = this.localTick - snap.tick;
            this.records.push({
              snapTick: snap.tick,
              localTick: this.localTick,
              replayWindow,
              hash: hashStateBuffer(snap.state),
            });
          }
        }
      });
      ws.on('error', reject);
    });
  }

  waitFor(pred, timeoutMs = 20000) {
    const existing = this.controls.find(pred);
    if (existing) return Promise.resolve(existing);
    return new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error(`${this.name}: timed out waiting`)), timeoutMs);
      this._waiters.push({ pred, resolve: (m) => { clearTimeout(t); res(m); } });
    });
  }

  // Mirrors tick(): send an input for this localTick and bump the clock,
  // exactly like the FixedTimestepLoop-driven tick() in net-match.ts.
  driveTick(stickX) {
    this.localTick++;
    if (this.ws.readyState === WebSocket.OPEN && this.mySlot >= 0) {
      const input = { tick: this.localTick, buttons: 0, stickX, stickY: 0 };
      this.inputHistory.set(this.localTick, input);
      this.ws.send(encodeInput(input));
    }
  }

  dropSocket() {
    this._everResumed = true; // about to attempt a resume next
    this.ws.terminate();
  }

  close() {
    try { this.ws.close(); } catch { /* ignore */ }
  }
}

async function runCycles(host, port, cycles, fixLocalTickBug, label) {
  const a = new ScriptedClient(host, port, 'Harness-A');
  const b = new ScriptedClient(host, port, 'Harness-B');
  const c = new ScriptedClient(host, port, 'Harness-C');
  await a.connect(fixLocalTickBug);
  await b.connect(fixLocalTickBug);
  await c.connect(fixLocalTickBug);
  await a.waitFor((m) => m.t === 'welcome');
  await b.waitFor((m) => m.t === 'welcome');
  await c.waitFor((m) => m.t === 'welcome');
  await a.waitFor((m) => m.t === 'matchStart');
  await b.waitFor((m) => m.t === 'matchStart');
  await c.waitFor((m) => m.t === 'matchStart');

  const interval = setInterval(() => {
    if (a.ws.readyState === WebSocket.OPEN) a.driveTick(65536);
    if (b.ws.readyState === WebSocket.OPEN) b.driveTick(-65536);
    if (c.ws.readyState === WebSocket.OPEN) c.driveTick(65536);
  }, 33);

  const summary = [];
  for (let i = 0; i < cycles; i++) {
    await new Promise((r) => setTimeout(r, 400));
    a.dropSocket();
    await new Promise((r) => setTimeout(r, 250));
    const preRecords = a.records.length;
    await a.connect(fixLocalTickBug);
    await a.waitFor((m) => m.t === 'welcome' && m.resumed === true);
    await a.waitFor((m) => m.t === 'matchStart');
    await new Promise((r) => setTimeout(r, 500));
    const postCycleRecords = a.records.slice(preRecords);
    const worstReplayWindow = postCycleRecords.length
      ? Math.min(...postCycleRecords.map((r) => r.replayWindow))
      : null;
    const hashMismatch = postCycleRecords.some((r, idx) => {
      const bAt = b.records[b.records.length - postCycleRecords.length + idx];
      return bAt && bAt.hash !== r.hash && bAt.snapTick === r.snapTick;
    });
    summary.push({ cycle: i, worstReplayWindow, sampleCount: postCycleRecords.length, hashMismatch });
  }
  clearInterval(interval);
  a.close(); b.close(); c.close();
  console.log(`\n=== ${label} ===`);
  for (const s of summary) {
    console.log(
      `cycle ${s.cycle}: replayWindow(min)=${s.worstReplayWindow} samples=${s.sampleCount} authoritative-hash-mismatch=${s.hashMismatch}`,
    );
  }
  const stuckNegative = summary.filter((s) => s.worstReplayWindow !== null && s.worstReplayWindow < -10).length;
  console.log(
    `${label}: ${stuckNegative}/${summary.length} cycles show replayWindow stuck well below zero (client-side prediction replay dead) after resume.`,
  );
  return summary;
}

async function main() {
  let server = null;
  let host = HOST;
  let port = PORT;
  if (SPAWN_LOCAL) {
    server = startLocalServer(port);
    await waitForHealth(host, port, 90000);
  } else {
    await waitForHealth(host, port, 15000);
  }
  try {
    console.log('Running WITHOUT fix (reproduces net-match.ts current behaviour)...');
    await runCycles(host, port, CYCLES, false, 'unpatched (current net-match.ts behaviour)');
    console.log('\nRunning WITH candidate fix (resync localTick to snap.tick)...');
    await runCycles(host, port, CYCLES, true, 'candidate fix (localTick resynced on resume)');
  } finally {
    if (server) {
      console.log('\n--- server log tail ---');
      console.log(server.getLog().split('\n').slice(-30).join('\n'));
      server.proc.kill();
    }
  }
}

main().catch((err) => {
  console.error('harness failed:', err);
  process.exit(1);
});
