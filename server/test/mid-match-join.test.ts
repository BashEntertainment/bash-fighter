// A client that hellos in *after* a match has already left the lobby phase
// (past countdown, sim ticks running) must never be inserted as a live
// fighter into that in-progress match -- that would be an unfair 0%-into-
// an-ongoing-brawl spawn and, worse, a determinism risk (every other
// client's sim never allocated a seat for this late arrival). It must
// instead land in a fresh lobby (or eventually be a spectator once
// spectator hand-off for latecomers is built), never inside the running
// match's fighter roster.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { WebSocket } from 'ws';
import { PROTOCOL_VERSION, encodeInput } from '@bash-fighter/net/src/protocol.ts';

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
  return spawn(
    process.execPath,
    ['--experimental-strip-types', new URL('../src/index.ts', import.meta.url).pathname],
    {
      env: {
        ...process.env,
        PORT: String(port),
        MATCH_CAPACITY: '2',
        MATCH_MINIMUM: '2',
        MATCH_COUNTDOWN_SECONDS: '1',
        MATCH_BOT_FILL_SECONDS: '100000', // no bot-fill noise in this test
        ...extraEnv,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
}

interface ControlMsg {
  t: string;
  [k: string]: unknown;
}

function connectClient(
  port: number,
  name: string,
): Promise<{
  ws: WebSocket;
  controls: ControlMsg[];
  waitFor: (pred: (m: ControlMsg) => boolean, timeoutMs?: number) => Promise<ControlMsg>;
}> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${port}/socket`);
    const controls: ControlMsg[] = [];
    const waiters: { pred: (m: ControlMsg) => boolean; resolve: (m: ControlMsg) => void }[] = [];
    const timer = setTimeout(() => reject(new Error(`${name} never opened`)), 20000);

    ws.on('open', () => {
      clearTimeout(timer);
      ws.send(JSON.stringify({ t: 'hello', protocolVersion: PROTOCOL_VERSION, name }));
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
      });
    });
    ws.on('message', (data, isBinary) => {
      if (isBinary) return;
      const msg = JSON.parse(data.toString()) as ControlMsg;
      controls.push(msg);
      for (let i = waiters.length - 1; i >= 0; i--) {
        if (waiters[i].pred(msg)) {
          const [w] = waiters.splice(i, 1);
          w.resolve(msg);
        }
      }
    });
    ws.on('error', reject);
  });
}

test('a client joining after a match has started lands in a new lobby, not as a live fighter in the running match', async () => {
  const port = 8112;
  const server = startServer(port, {});
  let log = '';
  server.stdout?.on('data', (d) => (log += d.toString()));
  server.stderr?.on('data', (d) => (log += d.toString()));
  try {
    await waitForHealth(port, 90000);

    // Fill a 2-capacity match and let it start.
    const a = await connectClient(port, 'Alice');
    const b = await connectClient(port, 'Bob');
    const welcomeA = (await a.waitFor((m) => m.t === 'welcome')) as ControlMsg & { matchId: string; slot: number };
    const welcomeB = (await b.waitFor((m) => m.t === 'welcome')) as ControlMsg & { matchId: string };
    await a.waitFor((m) => m.t === 'matchStart');
    await b.waitFor((m) => m.t === 'matchStart');
    assert.equal(welcomeA.matchId, welcomeB.matchId, 'sanity: both starters share the same match');
    const runningMatchId = welcomeA.matchId;

    // Drive a few real sim ticks so the match is unambiguously in-flight,
    // not just past countdown by a hair.
    let tick = 0;
    const interval = setInterval(() => {
      tick++;
      if (a.ws.readyState === WebSocket.OPEN) a.ws.send(encodeInput({ tick, buttons: 0, stickX: 0, stickY: 0 }));
      if (b.ws.readyState === WebSocket.OPEN) b.ws.send(encodeInput({ tick, buttons: 0, stickX: 0, stickY: 0 }));
    }, 33);
    await new Promise((r) => setTimeout(r, 400));

    // Cara joins now, well after the match left the lobby phase.
    const cara = await connectClient(port, 'Cara');
    const welcomeCara = (await cara.waitFor((m) => m.t === 'welcome')) as ControlMsg & {
      matchId: string;
      slot: number;
    };

    // Must NOT be handed a seat inside the already-running match.
    assert.notEqual(
      welcomeCara.matchId,
      runningMatchId,
      `late joiner must not be placed into the already-started match; server log:\n${log}`,
    );

    // And she must see a fresh lobby, not a matchStart into combat.
    const nextMsg = await cara.waitFor((m) => m.t === 'lobby' || m.t === 'matchStart');
    assert.equal(
      nextMsg.t,
      'lobby',
      `late joiner should be placed in a lobby awaiting the next match, not started straight into combat; server log:\n${log}`,
    );

    clearInterval(interval);
    a.ws.close();
    b.ws.close();
    cara.ws.close();
  } finally {
    server.kill();
  }
});
