// Regression test for the "End-of-Match Screen Missing Entirely" bug
// (2026-09-09, see wiki page of the same name): onMatchEnd must report
// whether the sim itself decided the match (resolved=true: a real
// winner, or a genuine draw) versus the server tearing an unfinished
// bot-only fight down early because every human left (resolved=false,
// isAbandonedByHumans). The client uses this bit to decide whether an
// already-eliminated player still gets a real result screen -- getting
// it wrong either hides a legitimate result (the regression) or shows a
// spurious one for a match the player had no part in finishing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Match, type MatchEvents } from '../src/match.ts';

function noopEvents(onMatchEnd: MatchEvents['onMatchEnd']): MatchEvents {
  return {
    onStart: () => {},
    onSnapshot: () => {},
    onEliminated: () => {},
    onMatchEnd,
    onSeatGraceExpired: () => {},
  };
}

test('a match that plays out to a real winner reports resolved=true', () => {
  const calls: Array<[number | null, number[], number, boolean]> = [];
  const match = new Match('resolved-test-1', 2, 1, noopEvents((w, lb, t, r) => calls.push([w, lb, t, r])));
  match.addSeat('human-a', false);
  match.addSeat('human-b', false);
  process.env.MATCH_SHRINK_FULLY_CLOSED_TICK = '60';
  match.start();
  clearInterval((match as unknown as { timer: NodeJS.Timeout }).timer as NodeJS.Timeout);
  (match as unknown as { timer: null }).timer = null;
  for (let i = 0; i < 20000 && calls.length === 0; i++) {
    (match as unknown as { tickOnce(): void }).tickOnce();
  }
  delete process.env.MATCH_SHRINK_FULLY_CLOSED_TICK;
  assert.equal(calls.length, 1, 'match should end exactly once');
  assert.equal(calls[0][3], true, 'a naturally-resolved match must report resolved=true');
});

test('a match abandoned by every human (bot-only) reports resolved=false', () => {
  const calls: Array<[number | null, number[], number, boolean]> = [];
  const match = new Match('resolved-test-2', 3, 1, noopEvents((w, lb, t, r) => calls.push([w, lb, t, r])));
  const a = match.addSeat('human-a', false);
  match.addSeat('bot-1', true);
  match.addSeat('bot-2', true);
  process.env.MATCH_SHRINK_FULLY_CLOSED_TICK = '600000'; // long enough that it won't fire first
  match.start();
  clearInterval((match as unknown as { timer: NodeJS.Timeout }).timer as NodeJS.Timeout);
  (match as unknown as { timer: null }).timer = null;
  // Simulate the human seat disconnecting and its grace window fully
  // expiring (resumeToken cleared), which is what isAbandonedByHumans
  // actually checks -- not just "not connected".
  a.connected = false;
  a.resumeToken = null;
  for (let i = 0; i < 20000 && calls.length === 0; i++) {
    (match as unknown as { tickOnce(): void }).tickOnce();
  }
  delete process.env.MATCH_SHRINK_FULLY_CLOSED_TICK;
  assert.equal(calls.length, 1, 'match should end exactly once');
  assert.equal(calls[0][3], false, 'a match abandoned by every human must report resolved=false');
});

// Regression for the 2026-09-09 design change: a match must keep running
// while ANY client is connected -- playing or spectating -- and only be
// treated as abandoned once the transport reports zero connected
// watchers. See wiki "Match Duration Contradiction: The Spire Firing
// Squad" and Match.isAbandoned() in server/src/match.ts.
test('a match with a spectator watching is not considered abandoned after every human seat is eliminated', () => {
  const match = new Match('resolved-test-3', 3, 1, noopEvents(() => {}));
  const a = match.addSeat('human-a', false);
  match.addSeat('bot-1', true);
  match.addSeat('bot-2', true);

  a.connected = false;
  a.resumeToken = null;
  assert.equal(
    (match as unknown as { isAbandonedByHumans(): boolean }).isAbandonedByHumans(),
    true,
    'sanity check: the old human-seat-only rule would call this abandoned',
  );

  match.setWatcherCount(1);
  assert.equal(
    (match as unknown as { isAbandoned(): boolean }).isAbandoned(),
    false,
    'a match with a connected spectator must not be considered abandoned',
  );

  match.setWatcherCount(0);
  assert.equal(
    (match as unknown as { isAbandoned(): boolean }).isAbandoned(),
    true,
    'once nobody at all is connected, it must be considered abandoned',
  );
});

test('a match is force-ended past its absolute max duration even with a spectator connected throughout', () => {
  const calls: Array<[number | null, number[], number, boolean]> = [];
  const match = new Match('resolved-test-5', 3, 1, noopEvents((w, lb, t, r) => calls.push([w, lb, t, r])));
  match.addSeat('human-a', false);
  match.addSeat('bot-1', true);
  match.addSeat('bot-2', true);
  match.start();
  clearInterval((match as unknown as { timer: NodeJS.Timeout }).timer as NodeJS.Timeout);
  (match as unknown as { timer: null }).timer = null;
  match.setWatcherCount(1); // a spectator never leaves for the whole test

  const maxTicks = (Match as unknown as { MAX_MATCH_TICKS: number }).MAX_MATCH_TICKS;
  assert.ok(maxTicks > 0, 'sanity check: a real ceiling is configured');
  // Jump straight to just past the ceiling instead of ticking the sim
  // that many times for real -- this test is about the ceiling check,
  // not about how long it takes bots to fight to a natural resolution.
  (match as unknown as { matchStartedAtTick: number }).matchStartedAtTick = -(maxTicks + 5);

  (match as unknown as { tickOnce(): void }).tickOnce();
  assert.equal(calls.length, 1, 'match must be force-ended once past the absolute duration ceiling');
  assert.equal(calls[0][3], false, 'a max-duration cutoff is not a natural resolution');
});
