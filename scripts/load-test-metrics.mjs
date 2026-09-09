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
//        node --experimental-strip-types scripts/load-test-metrics.mjs --target=http://135.181.45.254 [--ssh-host=root@135.181.45.254]
//
// --target points the load generator at an already-running server instead of
// spawning a local one. Both the websocket clients and the /api/health and
// /api/metrics reads go against <target>. This is how a remote production
// server gets measured by a load generator that isn't sharing its CPU. The
// default (no --target) behaviour of spawning a local ephemeral server is
// unchanged, so existing workflows keep working.
//
// When --target is remote, this process cannot read /proc for the server's
// RSS/CPU directly (that's on a different machine). If SSH access is
// available, RSS/CPU is sampled by shelling out to
// `ssh <ssh-host> cat /proc/<pid>/stat ...` against the systemd unit
// `bash-fighter`'s MainPID every 2s (ssh-host defaults to root@<target
// hostname>, override with --ssh-host=user@host). Pass --no-ssh-metrics to
// skip this and get bandwidth/tick/RTT numbers only.
import { spawn, execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { WebSocket } from 'ws';
import { hashStateBuffer } from '@bash-fighter/sim/src/hash.ts';
import { PROTOCOL_VERSION, BinaryTag, decodeSnapshot, encodeInput } from '@bash-fighter/net/src/protocol.ts';

const args = process.argv.slice(2);
function argValue(name) {
  const prefix = `--${name}=`;
  const hit = args.find((a) => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : undefined;
}
const hasFlag = (name) => args.includes(`--${name}`);

const TARGET = argValue('target'); // e.g. http://135.181.45.254
const REMOTE = Boolean(TARGET);
const NO_SSH_METRICS = hasFlag('no-ssh-metrics');
const SSH_HOST = argValue('ssh-host') || (REMOTE ? `root@${new URL(TARGET).hostname}` : undefined);

const PORT = 8198;
const NUM_CLIENTS = 20;
const HTTP_BASE = REMOTE ? TARGET.replace(/\/$/, '') : `http://localhost:${PORT}`;
const WS_URL = REMOTE ? `${TARGET.replace(/^http/, 'ws').replace(/\/$/, '')}/socket` : `ws://localhost:${PORT}/socket`;

let sshFailureCount = 0;
let sshFailureLoggedAt = 0;
function sshExec(cmd, timeoutMs = 15000) {
  return new Promise((resolve) => {
    execFile(
      'ssh',
      ['-o', 'ConnectTimeout=8', '-o', 'BatchMode=yes', SSH_HOST, cmd],
      { timeout: timeoutMs },
      (err, stdout, stderr) => {
        if (err) {
          sshFailureCount++;
          // Loud, but rate-limited to once/10s -- a silent empty RSS/CPU
          // section is worse than noisy stderr (a real remote run over a
          // slow round trip needs more than a tight few-second timeout, and
          // that failure mode must not just print nothing).
          if (Date.now() - sshFailureLoggedAt > 10000) {
            sshFailureLoggedAt = Date.now();
            console.error(`ssh RSS/CPU sample failed (#${sshFailureCount} so far): ${err.message}${stderr ? ' | stderr: ' + stderr.trim() : ''}`);
          }
          resolve(null);
          return;
        }
        resolve(stdout);
      },
    );
  });
}

// The 'ws' npm package opens a raw TCP socket directly to the target host,
// bypassing the container's HTTP_PROXY entirely -- fine for localhost, but
// against a remote target behind this container's egress proxy the raw
// socket attempt just hangs (silently dropped, no error, no data). Node's
// built-in global WebSocket (undici-based) *does* honor HTTP_PROXY/
// NODE_USE_ENV_PROXY, confirmed working through the proxy against
// production. This thin adapter gives it the same on()/send()/close()/
// readyState surface the rest of this script already uses from 'ws', so
// only client construction needs to differ between local and remote mode.
class ProxyAwareWebSocket {
  static OPEN = 1;
  constructor(url) {
    this._listeners = { open: [], message: [], error: [], close: [] };
    this._ws = new global.WebSocket(url);
    this._ws.binaryType = 'arraybuffer';
    this._ws.onopen = () => this._emit('open');
    this._ws.onerror = (e) => this._emit('error', new Error(e.message || 'websocket error'));
    this._ws.onclose = (e) => this._emit('close', e.code, Buffer.from(e.reason || ''));
    this._ws.onmessage = (e) => {
      if (typeof e.data === 'string') this._emit('message', Buffer.from(e.data), false);
      else this._emit('message', Buffer.from(e.data), true);
    };
  }
  _emit(event, ...a) {
    for (const cb of this._listeners[event]) cb(...a);
  }
  on(event, cb) {
    this._listeners[event].push(cb);
    return this;
  }
  send(data) {
    this._ws.send(data);
  }
  close() {
    this._ws.close();
  }
  get readyState() {
    return this._ws.readyState;
  }
}

let remoteServerPid;
async function getRemotePid() {
  if (remoteServerPid) return remoteServerPid;
  const out = await sshExec('systemctl show -p MainPID --value bash-fighter');
  const pid = out && Number(out.trim());
  if (pid) remoteServerPid = pid;
  return remoteServerPid;
}

async function readRemoteProcStat() {
  const pid = await getRemotePid();
  if (!pid) return null;
  const out = await sshExec(`cat /proc/${pid}/statm /proc/${pid}/stat`);
  if (!out) return null;
  const lines = out.trim().split('\n');
  if (lines.length < 2) return null;
  const statm = lines[0].split(' ');
  const rssPages = Number(statm[1]);
  const pageSizeKb = 4;
  const stat = lines.slice(1).join('\n');
  const afterComm = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
  const utime = Number(afterComm[11]);
  const stime = Number(afterComm[12]);
  return { rssKb: rssPages * pageSizeKb, utimeTicks: utime, stimeTicks: stime };
}

function waitForHealth(base, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      fetch(`${base}/api/health`)
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
  if (REMOTE) {
    console.log(`REMOTE MODE: targeting ${TARGET} (ws: ${WS_URL})`);
    if (!NO_SSH_METRICS) console.log(`RSS/CPU via ssh ${SSH_HOST} (systemd unit "bash-fighter")`);
  }
  const serverProc = REMOTE
    ? null
    : spawn(
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
  if (serverProc) {
    serverProc.stdout.on('data', (d) => (serverLog += d.toString()));
    serverProc.stderr.on('data', (d) => (serverLog += d.toString()));
  }

  const rssCpuSamples = [];
  const tickMetricSamples = [];
  const hz = 100;
  // Guard against overlap: an ssh round trip to a real remote host can take
  // longer than the 2s sample period under load, and setInterval does not
  // wait for an async callback to finish before firing the next one. Without
  // this guard, slow ssh calls stack up concurrently, each one making the
  // next one slower still (auth/connection contention), which was observed
  // to snowball into the whole script stalling well past its own timeout.
  let samplingInFlight = false;
  const sampleInterval = setInterval(async () => {
    if (samplingInFlight) return;
    samplingInFlight = true;
    try {
      const s = REMOTE ? (NO_SSH_METRICS ? null : await readRemoteProcStat()) : readProcStat(serverProc.pid);
      if (s) rssCpuSamples.push({ t: Date.now(), ...s });
      try {
        const m = await fetch(`${HTTP_BASE}/api/metrics`).then((r) => r.json());
        tickMetricSamples.push({ t: Date.now(), ...m });
      } catch {}
    } finally {
      samplingInFlight = false;
    }
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
    await waitForHealth(HTTP_BASE, 20000);
    console.log('server up, connecting', NUM_CLIENTS, 'clients...');

    // REMOTE-only: this container's egress proxy has been observed to kill
    // proxied plain-HTTP websocket connections to an arbitrary destination
    // after a fixed ~10s, independent of activity (measured with isolated
    // idle and active-sender probes: consistently code 1006 at ~9.6-10.0s
    // after open, even mid-send with no errors). The server's own
    // reconnect-with-resume-token support (packages/net PROTOCOL_VERSION 2,
    // 45s seat grace) exists for exactly this kind of drop, so on an
    // unexpected close mid-test we resume instead of giving up -- otherwise
    // a real ~75s match can never be observed end-to-end from this
    // container over this egress path. Reconnects are counted and reported;
    // treat a high reconnect count as a sign RTT/bandwidth numbers include
    // reconnect overhead, not a clean steady-state connection.
    let stopReconnecting = false;
    let totalReconnects = 0;

    function wireClient(cstate, i, resolveWelcome, rejectWelcome) {
      const ws = cstate.ws;
      const timer = resolveWelcome
        ? setTimeout(() => rejectWelcome(new Error(`client ${i} never got welcome`)), 15000)
        : null;
      ws.on('open', () => {
        const helloMsg = cstate.resumeToken
          ? JSON.stringify({ t: 'hello', protocolVersion: PROTOCOL_VERSION, name: `LoadBot${i}`, resume: cstate.resumeToken })
          : JSON.stringify({ t: 'hello', protocolVersion: PROTOCOL_VERSION, name: `LoadBot${i}` });
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
            if (msg.matchId) cstate.matchId = msg.matchId;
            if (msg.resumeToken) cstate.resumeToken = msg.resumeToken;
            if (timer) clearTimeout(timer);
            if (resolveWelcome) resolveWelcome();
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
      ws.on('error', (e) => {
        if (rejectWelcome) rejectWelcome(e);
      });
      ws.on('close', () => {
        if (!REMOTE || stopReconnecting || cstate.matchEnded) return;
        if (!cstate.resumeToken) {
          console.error(`client ${i} dropped (code likely 1006) with no resume token yet -- cannot rejoin, giving up on this client`);
          return;
        }
        totalReconnects++;
        cstate.ws = new ProxyAwareWebSocket(WS_URL);
        wireClient(cstate, i, null, null);
      });
    }

    const connectPromises = [];
    for (let i = 0; i < NUM_CLIENTS; i++) {
      const ws = REMOTE ? new ProxyAwareWebSocket(WS_URL) : new WebSocket(WS_URL);
      const cstate = {
        ws,
        slot: -1,
        matchId: null,
        resumeToken: null,
        matchEnded: false,
        lastState: null,
        tick: 0,
        snapshotCount: 0,
        pendingSends: new Map(),
      };
      clients.push(cstate);
      const p = new Promise((resolve, reject) => wireClient(cstate, i, resolve, reject));
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
    stopReconnecting = true;
    const durationMs = Date.now() - start;

    const allEnded = clients.every((c) => c.matchEnded);
    console.log(`match ${allEnded ? 'ended cleanly' : 'DID NOT END within ' + maxWaitMs + 'ms'} after ${durationMs}ms`);
    if (REMOTE) console.log(`reconnects during run: ${totalReconnects} (non-zero means RTT/bandwidth include reconnect overhead, not a clean steady-state connection)`);

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
    const finalSample = REMOTE ? (NO_SSH_METRICS ? null : await readRemoteProcStat()) : readProcStat(serverProc.pid);
    if (finalSample) rssCpuSamples.push({ t: Date.now(), ...finalSample });
    let finalMetrics;
    try {
      finalMetrics = await fetch(`${HTTP_BASE}/api/metrics`).then((r) => r.json());
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
    } else if (REMOTE && !NO_SSH_METRICS) {
      console.log(`EMPTY -- 0 usable samples out of ~${Math.round(durationMs / 2000)} attempts, ${sshFailureCount} ssh failures logged above. RSS/CPU for this run is an unknown, not a zero.`);
    } else if (NO_SSH_METRICS) {
      console.log('skipped (--no-ssh-metrics)');
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
    // On any exit path (success or failure) stop reconnecting and close
    // every client socket explicitly. Without this, a client that errored
    // out of the initial connect (e.g. never got a welcome) can leave other
    // clients' sockets open and their reconnect-on-close handlers armed --
    // those keep the event loop alive and keep re-establishing production
    // connections indefinitely after the script has already reported
    // failure and "finished".
    stopReconnecting = true;
    for (const c of clients) {
      try {
        c.ws.close();
      } catch {}
    }
    if (serverProc) serverProc.kill();
  }
}

main();
