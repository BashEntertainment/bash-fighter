// Verifies the character-selection wire path added for the character-select
// UI: a client's `hello.characterId` is echoed back (resolved, per-seat) in
// `matchStart.characterIds`, in slot order, and an omitted characterId
// still defaults to the placeholder id for backward compatibility.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { WebSocket } from 'ws';
import { PROTOCOL_VERSION } from '@bash-fighter/net/src/protocol.ts';

const PORT = 8098;
const NUM_CLIENTS = 2;

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

test('hello.characterId flows through to matchStart.characterIds, per seat, with a default fallback', async () => {
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
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  let serverLog = '';
  serverProc.stdout?.on('data', (d) => (serverLog += d.toString()));
  serverProc.stderr?.on('data', (d) => (serverLog += d.toString()));

  try {
    await waitForHealth(PORT, 90000);

    const requested = ['ballast', undefined]; // client 1 picks Ballast, client 2 sends nothing
    const characterIdsBySlot: Record<number, string> = {};
    const connectPromises: Promise<void>[] = [];
    const sockets: WebSocket[] = [];

    for (let i = 0; i < NUM_CLIENTS; i++) {
      const ws = new WebSocket(`ws://localhost:${PORT}/socket`);
      sockets.push(ws);
      const p = new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`client ${i} never saw matchStart`)), 10000);
        ws.on('open', () => {
          const hello: Record<string, unknown> = { t: 'hello', protocolVersion: PROTOCOL_VERSION, name: `Bot${i}` };
          if (requested[i]) hello.characterId = requested[i];
          ws.send(JSON.stringify(hello));
        });
        ws.on('message', (data, isBinary) => {
          if (isBinary) return;
          const msg = JSON.parse(data.toString());
          if (msg.t === 'matchStart') {
            assert.ok(Array.isArray(msg.characterIds), 'matchStart must include characterIds');
            assert.equal(msg.characterIds.length, msg.names.length, 'characterIds parallels names/seats');
            for (let slot = 0; slot < msg.characterIds.length; slot++) {
              characterIdsBySlot[slot] = msg.characterIds[slot];
            }
            clearTimeout(timer);
            resolve();
          }
        });
        ws.on('error', reject);
      });
      connectPromises.push(p);
    }

    await Promise.all(connectPromises);

    assert.equal(characterIdsBySlot[0], 'ballast', `slot 0 requested ballast; server log:\n${serverLog}`);
    assert.equal(
      characterIdsBySlot[1],
      'placeholder',
      `slot 1 sent no characterId and must default to placeholder; server log:\n${serverLog}`,
    );

    for (const ws of sockets) ws.close();
  } finally {
    serverProc.kill();
  }
});
