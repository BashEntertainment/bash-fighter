// Full-stack desync-proofing test: starts the real server as a child
// process, connects several headless WebSocket clients, plays a match to
// completion by sending random-but-valid inputs, and asserts every
// client's final snapshot state hash is identical (i.e. every client saw
// byte-identical authoritative state over the real wire protocol, through
// real encode/decode, not just in-process function calls).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { WebSocket } from 'ws';
import { hashStateBuffer } from '@bash-fighter/sim/src/hash.ts';
import {
  PROTOCOL_VERSION,
  BinaryTag,
  decodeSnapshot,
  encodeInput,
} from '@bash-fighter/net/src/protocol.ts';

const PORT = 8099;
const NUM_CLIENTS = 3;

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

interface ClientState {
  ws: WebSocket;
  slot: number;
  matchEnded: boolean;
  lastState: Int32Array | null;
  tick: number;
}

test('a full match played over real WebSockets ends with identical state hashes on every client', async () => {
  const serverProc: ChildProcess = spawn(
    process.execPath,
    ['--experimental-strip-types', new URL('../src/index.ts', import.meta.url).pathname],
    {
      env: {
        ...process.env,
        PORT: String(PORT),
        MATCH_CAPACITY: String(NUM_CLIENTS),
        MATCH_MINIMUM: String(NUM_CLIENTS),
        MATCH_COUNTDOWN_SECONDS: '1',
        MATCH_SHRINK_FULLY_CLOSED_TICK: '300', // 5s: force a fast match for this test
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  let serverLog = '';
  serverProc.stdout?.on('data', (d) => (serverLog += d.toString()));
  serverProc.stderr?.on('data', (d) => (serverLog += d.toString()));

  try {
    await waitForHealth(PORT, 8000);

    const clients: ClientState[] = [];
    const connectPromises: Promise<void>[] = [];

    for (let i = 0; i < NUM_CLIENTS; i++) {
      const ws = new WebSocket(`ws://localhost:${PORT}/socket`);
      const cstate: ClientState = { ws, slot: -1, matchEnded: false, lastState: null, tick: 0 };
      clients.push(cstate);
      const p = new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`client ${i} never got welcome`)), 8000);
        ws.on('open', () => {
          ws.send(JSON.stringify({ t: 'hello', protocolVersion: PROTOCOL_VERSION, name: `Bot${i}` }));
        });
        ws.on('message', (data, isBinary) => {
          if (!isBinary) {
            const msg = JSON.parse(data.toString());
            if (msg.t === 'welcome') {
              cstate.slot = msg.slot;
              clearTimeout(timer);
              resolve();
            }
            if (msg.t === 'matchEnd') {
              cstate.matchEnded = true;
            }
          } else {
            const buf = data as Buffer;
            if (buf[0] === BinaryTag.SNAPSHOT) {
              const snap = decodeSnapshot(new Uint8Array(buf));
              if (snap) {
                cstate.lastState = snap.state;
                cstate.tick = snap.tick;
              }
            }
          }
        });
        ws.on('error', reject);
      });
      connectPromises.push(p);
    }

    await Promise.all(connectPromises);

    // Drive the match: send a modest, deterministic-ish input pattern from
    // each client at ~30Hz so the match actually plays out (moving off
    // spawn, no attacks needed — elimination happens via the shrinking
    // arena in the battle-royale default settings).
    let inputTick = 0;
    const inputInterval = setInterval(() => {
      inputTick++;
      for (const c of clients) {
        if (c.ws.readyState !== WebSocket.OPEN) continue;
        const dir = c.slot % 2 === 0 ? 1 : -1;
        const bytes = encodeInput({
          tick: inputTick,
          buttons: 0,
          stickX: dir * 65536,
          stickY: 0,
        });
        c.ws.send(bytes);
      }
    }, 33);

    const start = Date.now();
    const maxWaitMs = 60_000;
    while (!clients.every((c) => c.matchEnded)) {
      if (Date.now() - start > maxWaitMs) break;
      await new Promise((r) => setTimeout(r, 200));
    }
    clearInterval(inputInterval);

    assert.ok(
      clients.every((c) => c.matchEnded),
      `not all clients saw matchEnd within ${maxWaitMs}ms; server log:\n${serverLog}`,
    );
    assert.ok(
      clients.every((c) => c.lastState !== null),
      'every client should have received at least one snapshot',
    );

    const hashes = clients.map((c) => hashStateBuffer(c.lastState as Int32Array));
    const first = hashes[0];
    for (let i = 1; i < hashes.length; i++) {
      assert.equal(
        hashes[i],
        first,
        `client ${i} final state hash (${hashes[i]}) diverged from client 0 (${first})`,
      );
    }

    for (const c of clients) c.ws.close();
  } finally {
    serverProc.kill();
  }
});
