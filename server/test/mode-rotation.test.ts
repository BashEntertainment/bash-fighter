// Mode rotation tests (2026-09-11, Timed Brawl launch). Two layers:
//   1. Pure unit tests of decideMatchMode/modeDisplayName -- no server,
//      no timers, exhaustively checks the cadence, the kill switch, and
//      the player-facing text.
//   2. An in-process RoomManager integration test that drives real
//      joinLobby() calls (2-capacity lobbies so each fills and starts
//      immediately) and checks that match creation, not connection,
//      decides the mode, and that the actual Match ends up running the
//      sim with the planned winCondition.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decideMatchMode, modeDisplayName, TIMED_BRAWL_TIME_LIMIT_TICKS } from '../src/mode-rotation.ts';
import { RoomManager } from '../src/rooms.ts';

test('decideMatchMode: exactly every Nth match (default cadence 3) is timedKO, the rest battleRoyale', () => {
  const modes = Array.from({ length: 12 }, (_, i) => decideMatchMode(i + 1).winCondition);
  assert.deepEqual(modes, [
    'battleRoyale', 'battleRoyale', 'timedKO',
    'battleRoyale', 'battleRoyale', 'timedKO',
    'battleRoyale', 'battleRoyale', 'timedKO',
    'battleRoyale', 'battleRoyale', 'timedKO',
  ]);
});

test('decideMatchMode: cadence is configurable', () => {
  // Cadence 4: every 4th match, and only every 4th, is timedKO.
  const modes = Array.from({ length: 8 }, (_, i) => decideMatchMode(i + 1, 4).winCondition);
  assert.deepEqual(modes, [
    'battleRoyale', 'battleRoyale', 'battleRoyale', 'timedKO',
    'battleRoyale', 'battleRoyale', 'battleRoyale', 'timedKO',
  ]);
});

test('decideMatchMode: cadence 1 makes every match timedKO (allowed, just an extreme config)', () => {
  for (let i = 1; i <= 5; i++) assert.equal(decideMatchMode(i, 1).winCondition, 'timedKO');
});

test('decideMatchMode: kill switch pins every match to battleRoyale regardless of cadence', () => {
  for (let i = 1; i <= 9; i++) {
    assert.equal(decideMatchMode(i, 3, true).winCondition, 'battleRoyale');
  }
});

test('decideMatchMode: the timedKO decision carries the 3-minute time limit; battleRoyale carries none', () => {
  const timed = decideMatchMode(3, 3, false);
  assert.equal(timed.winCondition, 'timedKO');
  assert.equal(timed.timeLimitTicks, TIMED_BRAWL_TIME_LIMIT_TICKS);
  assert.equal(timed.timeLimitTicks, 60 * 60 * 3);

  const royale = decideMatchMode(1, 3, false);
  assert.equal(royale.winCondition, 'battleRoyale');
  assert.equal(royale.timeLimitTicks, undefined);
});

test('modeDisplayName: never leaks the internal identifier, always plain language', () => {
  const royale = modeDisplayName('battleRoyale');
  const timed = modeDisplayName('timedKO', TIMED_BRAWL_TIME_LIMIT_TICKS);
  assert.ok(!royale.includes('battleRoyale'));
  assert.ok(!timed.includes('timedKO'));
  assert.match(royale, /Battle Royale/);
  assert.match(royale, /last fighter standing/i);
  assert.match(timed, /Timed Brawl/);
  assert.match(timed, /3 minutes/);
  assert.match(timed, /knockouts/i);
});

test('RoomManager: match creation (not connection) decides the mode, exactly 1-in-3', async () => {
  const noopEvents = () => ({ onSnapshot: () => {}, onEliminated: () => {} });
  const manager = new RoomManager(noopEvents, /* capacity */ 2, /* minimum */ 2);
  const seenModes: string[] = [];
  const seenMatchIds = new Set<string>();
  const startedMatches: Array<{ stop: () => void }> = [];
  for (let i = 0; i < 9; i++) {
    // Two joins fill and start a 2-capacity lobby immediately, so each
    // iteration creates exactly one fresh match.
    const first = manager.joinLobby(`p${i}a`);
    const second = manager.joinLobby(`p${i}b`);
    assert.equal(first.match.id, second.match.id, 'both seats landed in the same freshly created match');
    assert.ok(!seenMatchIds.has(first.match.id), 'each iteration created a genuinely new match');
    seenMatchIds.add(first.match.id);
    // Mode was decided (and, once start() ran, actually applied to the
    // sim) once per match -- both seats see the identical mode.
    seenModes.push(first.match.winCondition ?? 'null');
    startedMatches.push(first.match);
  }
  // Every one of these matches is really ticking on a real setInterval;
  // stop them all so this test doesn't leak timers into the rest of the
  // suite.
  for (const m of startedMatches) m.stop();
  assert.deepEqual(seenModes, [
    'battleRoyale', 'battleRoyale', 'timedKO',
    'battleRoyale', 'battleRoyale', 'timedKO',
    'battleRoyale', 'battleRoyale', 'timedKO',
  ]);
});
