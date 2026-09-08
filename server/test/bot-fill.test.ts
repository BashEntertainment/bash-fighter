// Bot-fill integration test (this task's brief item 4): a lobby with one
// real human connected must actually start a match promptly, filled out
// with server-controlled bots, rather than waiting forever for 19
// strangers. Starts the real server as a child process (same pattern as
// integration.test.ts), connects exactly one real WebSocket client, and
// asserts a matchStart arrives with bot-named opponents once the short
// MATCH_BOT_FILL_SECONDS grace period elapses.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { WebSocket } from 'ws';
import { PROTOCOL_VERSION } from '@bash-fighter/net/src/protocol.ts';

const PORT = 8098;
const CAPACITY = 6;

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

test('a lobby with one human is filled with bots and starts promptly', async () => {
  const serverProc: ChildProcess = spawn(
    process.execPath,
    ['--experimental-strip-types', new URL('../src/index.ts', import.meta.url).pathname],
    {
      env: {
        ...process.env,
        PORT: String(PORT),
        MATCH_CAPACITY: String(CAPACITY),
        MATCH_MINIMUM: String(CAPACITY), // never reachable by humans alone in this test
        MATCH_COUNTDOWN_SECONDS: '60', // long enough that only the bot-fill timer can start this match
        MATCH_BOT_FILL_SECONDS: '1',
        MATCH_BOT_FILL_TARGET: String(CAPACITY),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  let serverLog = '';
  serverProc.stdout?.on('data', (d) => (serverLog += d.toString()));
  serverProc.stderr?.on('data', (d) => (serverLog += d.toString()));

  try {
    await waitForHealth(PORT, 20000);

    const ws = new WebSocket(`ws://localhost:${PORT}/socket`);
    const matchStart: Promise<{ names: string[]; numFighters: number }> = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`no matchStart within timeout. server log:\n${serverLog}`)), 8000);
      ws.on('open', () => {
        ws.send(JSON.stringify({ t: 'hello', protocolVersion: PROTOCOL_VERSION, name: 'RealHuman' }));
      });
      ws.on('message', (data, isBinary) => {
        if (isBinary) return;
        const msg = JSON.parse(data.toString('utf8'));
        if (msg.t === 'matchStart') {
          clearTimeout(timer);
          resolve({ names: msg.names, numFighters: msg.numFighters });
        }
      });
      ws.on('error', reject);
    });

    const { names, numFighters } = await matchStart;
    assert.equal(numFighters, CAPACITY, 'match should have started at the bot-fill target size');
    assert.equal(names.length, CAPACITY);
    assert.equal(names[0], 'RealHuman', 'the real player keeps their own name/slot');
    const botNames = names.slice(1);
    assert.equal(botNames.length, CAPACITY - 1);
    for (const n of botNames) {
      assert.ok(n.startsWith('CPU '), `bot name "${n}" should be clearly distinguishable from a human's`);
    }
    // Bots must not be double-counted as connected human players.
    const health = await fetch(`http://localhost:${PORT}/api/health`).then((r) => r.json());
    assert.equal(health.playerCount, 1, 'only the one real client should count as a connected player');

    ws.close();
  } finally {
    serverProc.kill();
  }
});
