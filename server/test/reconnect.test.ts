// Reconnection: a dropped socket must not permanently lose a seat. Covers
// the four cases from the task brief: (a) reconnect resumes the same slot
// and keeps playing to an identical final hash, (b) a forged token is
// rejected cleanly, (c) a seat is released after its grace window expires
// and the token stops working, (d) reconnecting after the match already
// ended reports the outcome instead of erroring.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { WebSocket } from 'ws';
import { hashStateBuffer } from '@bash-fighter/sim/src/hash.ts';
import { PROTOCOL_VERSION, BinaryTag, decodeSnapshot, encodeInput } from '@bash-fighter/net/src/protocol.ts';

function waitForHealth(port: number, timeoutMs: number): Promise<void> {
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

function startServer(port: number, extraEnv: Record<string, string>): ChildProcess {
  const proc = spawn(
    process.execPath,
    ['--experimental-strip-types', new URL('../src/index.ts', import.meta.url).pathname],
    {
      env: {
        ...process.env,
        PORT: String(port),
        MATCH_CAPACITY: '3',
        MATCH_MINIMUM: '3',
        MATCH_COUNTDOWN_SECONDS: '1',
        MATCH_SHRINK_FULLY_CLOSED_TICK: '100000', // effectively no arena-shrink elimination in these tests
        ...extraEnv,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  return proc;
}

interface ControlMsg {
  t: string;
  [k: string]: unknown;
}

/** Connects one client, sends hello (optionally with a resume token), and
 *  resolves with every control message and binary snapshot seen, plus
 *  helpers to send input and close. */
function connectClient(
  port: number,
  name: string,
  resume?: string,
): Promise<{
  ws: WebSocket;
  controls: ControlMsg[];
  waitFor: (pred: (m: ControlMsg) => boolean, timeoutMs?: number) => Promise<ControlMsg>;
  lastSnapshot: () => { tick: number; state: Int32Array } | null;
}> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${port}/socket`);
    const controls: ControlMsg[] = [];
    const waiters: { pred: (m: ControlMsg) => boolean; resolve: (m: ControlMsg) => void }[] = [];
    let last: { tick: number; state: Int32Array } | null = null;
    const timer = setTimeout(() => reject(new Error(`${name} never opened`)), 20000);

    ws.on('open', () => {
      clearTimeout(timer);
      const hello: Record<string, unknown> = { t: 'hello', protocolVersion: PROTOCOL_VERSION, name };
      if (resume) hello.resume = resume;
      ws.send(JSON.stringify(hello));
      resolve({
        ws,
        controls,
        waitFor: (pred, timeoutMs = 20000) =>
          new Promise((res, rej) => {
            const existing = controls.find(pred);
            if (existing) {
              res(existing);
              return;
            }
            const t = setTimeout(() => rej(new Error(`${name}: timed out waiting for control message`)), timeoutMs);
            waiters.push({
              pred,
              resolve: (m) => {
                clearTimeout(t);
                res(m);
              },
            });
          }),
        lastSnapshot: () => last,
      });
    });
    ws.on('message', (data, isBinary) => {
      if (!isBinary) {
        const msg = JSON.parse(data.toString()) as ControlMsg;
        controls.push(msg);
        for (let i = waiters.length - 1; i >= 0; i--) {
          if (waiters[i].pred(msg)) {
            const [w] = waiters.splice(i, 1);
            w.resolve(msg);
          }
        }
      } else {
        const buf = data as Buffer;
        if (buf[0] === BinaryTag.SNAPSHOT) {
          const snap = decodeSnapshot(new Uint8Array(buf));
          if (snap) last = { tick: snap.tick, state: snap.state };
        }
      }
    });
    ws.on('error', reject);
  });
}

test('client drops mid-match, reconnects with its token, resumes the same slot, and finishes with a matching state hash', async () => {
  const port = 8101;
  const server = startServer(port, {});
  let log = '';
  server.stdout?.on('data', (d) => (log += d.toString()));
  server.stderr?.on('data', (d) => (log += d.toString()));
  try {
    await waitForHealth(port, 25000);

    const a = await connectClient(port, 'Alice');
    const b = await connectClient(port, 'Bob');
    const c = await connectClient(port, 'Cara');
    const welcomeA = (await a.waitFor((m) => m.t === 'welcome')) as ControlMsg & { resumeToken: string; slot: number };
    await b.waitFor((m) => m.t === 'welcome');
    await c.waitFor((m) => m.t === 'welcome');
    await a.waitFor((m) => m.t === 'matchStart');
    await b.waitFor((m) => m.t === 'matchStart');
    await c.waitFor((m) => m.t === 'matchStart');

    assert.ok(welcomeA.resumeToken, 'a real seat must get a resume token');
    const tokenA = welcomeA.resumeToken;
    const slotA = welcomeA.slot;

    // Drive some input from everyone so the sim actually advances.
    let tick = 0;
    const drive = (ws: WebSocket, slot: number) => {
      const dir = slot % 2 === 0 ? 1 : -1;
      ws.send(encodeInput({ tick, buttons: 0, stickX: dir * 65536, stickY: 0 }));
    };
    const interval = setInterval(() => {
      tick++;
      if (a.ws.readyState === WebSocket.OPEN) drive(a.ws, slotA);
      drive(b.ws, 1);
      drive(c.ws, 2);
    }, 33);

    // Let the match run a bit, then drop Alice's socket (not via stop() --
    // a raw close, like a network drop).
    await new Promise((r) => setTimeout(r, 500));
    a.ws.close();
    await new Promise((r) => setTimeout(r, 300));

    // Reconnect with the token: must land back on the SAME slot.
    const a2 = await connectClient(port, 'Alice', tokenA);
    const welcomeA2 = (await a2.waitFor((m) => m.t === 'welcome')) as ControlMsg & { slot: number; resumed: boolean };
    assert.equal(welcomeA2.resumed, true, 'reconnect welcome must be marked resumed');
    assert.equal(welcomeA2.slot, slotA, 'reconnecting must resume the SAME slot, not a new one');
    await a2.waitFor((m) => m.t === 'matchStart');

    // Play on a little longer with the reconnected client, then compare a
    // live snapshot hash across all three clients (avoids depending on
    // combat RNG to actually end the match here).
    await new Promise((r) => setTimeout(r, 500));
    clearInterval(interval);
    await new Promise((r) => setTimeout(r, 300));

    const snapA = a2.lastSnapshot();
    const snapB = b.lastSnapshot();
    const snapC = c.lastSnapshot();
    assert.ok(snapA && snapB && snapC, 'all three clients should have a snapshot after reconnect');
    const hashA = hashStateBuffer((snapA as { state: Int32Array }).state);
    const hashB = hashStateBuffer((snapB as { state: Int32Array }).state);
    const hashC = hashStateBuffer((snapC as { state: Int32Array }).state);
    assert.equal(hashA, hashB, `reconnected client's state hash diverged from client B; server log:\n${log}`);
    assert.equal(hashA, hashC, `reconnected client's state hash diverged from client C; server log:\n${log}`);

    a2.ws.close();
    b.ws.close();
    c.ws.close();
  } finally {
    server.kill();
  }
});

test('a wrong/forged token is rejected with an error frame and gets no seat', async () => {
  const port = 8102;
  const server = startServer(port, {});
  try {
    await waitForHealth(port, 25000);
    const forged = await connectClient(port, 'Mallory', 'not-a-real-token-'.padEnd(64, '0'));
    const err = (await forged.waitFor((m) => m.t === 'error' || m.t === 'welcome')) as ControlMsg;
    assert.equal(err.t, 'error', 'a forged token must not be granted a seat via welcome');
    assert.equal(err.code, 'resume_invalid');
    forged.ws.close();
  } finally {
    server.kill();
  }
});

test('a seat is released after the grace window expires and the token no longer works', async () => {
  const port = 8103;
  // Tiny grace window so the test doesn't wait out a real 30-60s default.
  const server = startServer(port, { MATCH_RECONNECT_GRACE_MS: '500' });
  try {
    await waitForHealth(port, 25000);
    const a = await connectClient(port, 'Alice');
    const b = await connectClient(port, 'Bob');
    const c = await connectClient(port, 'Cara');
    const welcomeA = (await a.waitFor((m) => m.t === 'welcome')) as ControlMsg & { resumeToken: string };
    await a.waitFor((m) => m.t === 'matchStart');
    await b.waitFor((m) => m.t === 'matchStart');
    await c.waitFor((m) => m.t === 'matchStart');

    const tokenA = welcomeA.resumeToken;
    a.ws.close();
    // Wait past the grace window.
    await new Promise((r) => setTimeout(r, 1200));

    const late = await connectClient(port, 'Alice-again', tokenA);
    const result = (await late.waitFor((m) => m.t === 'error' || m.t === 'welcome')) as ControlMsg;
    assert.equal(result.t, 'error', 'an expired token must not be granted a seat');
    assert.equal(result.code, 'resume_invalid');

    late.ws.close();
    b.ws.close();
    c.ws.close();
  } finally {
    server.kill();
  }
});

test('reconnecting after the match already ended reports the outcome instead of erroring', async () => {
  const port = 8104;
  const server = startServer(port, { MATCH_SHRINK_FULLY_CLOSED_TICK: '120' }); // ~2s: force a fast finish
  try {
    await waitForHealth(port, 25000);
    const a = await connectClient(port, 'Alice');
    const b = await connectClient(port, 'Bob');
    const c = await connectClient(port, 'Cara');
    const welcomeA = (await a.waitFor((m) => m.t === 'welcome')) as ControlMsg & { resumeToken: string };
    await a.waitFor((m) => m.t === 'matchStart');
    await b.waitFor((m) => m.t === 'matchStart');
    await c.waitFor((m) => m.t === 'matchStart');
    const tokenA = welcomeA.resumeToken;

    // Alice drops without ever getting eliminated; B and C keep playing
    // (neutral input from Alice's now-empty seat) until the shrinking
    // arena ends the match.
    let tick = 0;
    const interval = setInterval(() => {
      tick++;
      if (b.ws.readyState === WebSocket.OPEN) b.ws.send(encodeInput({ tick, buttons: 0, stickX: 65536, stickY: 0 }));
      if (c.ws.readyState === WebSocket.OPEN) c.ws.send(encodeInput({ tick, buttons: 0, stickX: -65536, stickY: 0 }));
    }, 33);
    a.ws.close();

    await b.waitFor((m) => m.t === 'matchEnd', 20000);
    clearInterval(interval);
    await new Promise((r) => setTimeout(r, 200)); // let the server settle phase='ended'

    const reconnected = await connectClient(port, 'Alice-again', tokenA);
    const msg = (await reconnected.waitFor((m) => m.t === 'welcome' || m.t === 'error')) as ControlMsg;
    assert.equal(msg.t, 'welcome', `reconnect after match end should still be honoured; got: ${JSON.stringify(msg)}`);
    const outcome = await reconnected.waitFor((m) => m.t === 'matchEnd');
    assert.ok('winner' in outcome && 'leaderboard' in outcome, 'must report the actual match outcome, not an error');

    reconnected.ws.close();
    b.ws.close();
    c.ws.close();
  } finally {
    server.kill();
  }
});
