// Regression/coverage tests for the stockLoss production log (2026-09-12,
// see wiki "Bash Entertainment Overview" for pointers to the Stocks mode
// design docs). Before this, a death that only consumed a stock and
// respawned was logged nowhere in production -- the server only ever
// logged 'elimination' when the sim's ELIMINATED flag got set (stocks
// exhausted) -- so Stocks mode was unverifiable from production ground
// truth. These tests run a real in-process Match with the stocks win
// condition and assert the human seat's first death emits exactly one
// stockLoss (and does not eliminate/respawn is observed), its second
// death emits the existing elimination event with a placement and no
// stockLoss, and that battleRoyale (no respawns, startingStocks forced
// to 1) never emits stockLoss at all.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Match, type MatchEvents } from '../src/match.ts';
import { BotDifficulty } from '@bash-fighter/sim/src/ai/bot.ts';

function noopEvents(onEliminated: MatchEvents['onEliminated'] = () => {}): MatchEvents {
  return {
    onStart: () => {},
    onSnapshot: () => {},
    onEliminated,
    onMatchEnd: () => {},
    onSeatGraceExpired: () => {},
  };
}

/** Capture console.log JSON lines with evt === wanted evt name, restoring
 *  the real console.log when done. Real production logging goes through
 *  plain console.log(JSON.stringify(...)) (see server/src/match.ts), so
 *  this is the same mechanism production log-scraping (journalctl | grep)
 *  observes -- just captured in-process instead of via journald. */
function captureLogs(run: () => void): Array<Record<string, unknown>> {
  const events: Array<Record<string, unknown>> = [];
  const realLog = console.log;
  console.log = ((...args: unknown[]) => {
    const [line] = args;
    if (typeof line === 'string') {
      try {
        const parsed = JSON.parse(line);
        if (parsed && typeof parsed === 'object') events.push(parsed as Record<string, unknown>);
      } catch {
        // not a JSON log line -- ignore
      }
    }
  }) as typeof console.log;
  try {
    run();
  } finally {
    console.log = realLog;
  }
  return events;
}

function runTicks(match: Match, maxTicks: number, until: () => boolean): void {
  clearInterval((match as unknown as { timer: NodeJS.Timeout }).timer as NodeJS.Timeout);
  (match as unknown as { timer: null }).timer = null;
  for (let i = 0; i < maxTicks && !until(); i++) {
    (match as unknown as { tickOnce(): void }).tickOnce();
  }
}

test('stocks mode: human seat first death emits exactly one stockLoss, does not eliminate, and respawns', () => {
  process.env.MATCH_WIN_CONDITION = 'stocks';
  process.env.MATCH_STARTING_STOCKS = '2';
  // Close the ring fast so the human (standing still on neutral input)
  // reliably dies to ring pressure well within the tick ceiling below,
  // same pattern as match-end-resolved.test.ts's MATCH_SHRINK_FULLY_CLOSED_TICK use.
  process.env.MATCH_SHRINK_FULLY_CLOSED_TICK = '90';
  try {
    let eliminatedCalls = 0;
    const match = new Match('stockloss-test-1', 2, 1, noopEvents((slot) => { if (slot === 0) eliminatedCalls++; }));
    match.addSeat('human-a', false);
    const bot = match.addSeat('bot-1', true, undefined as unknown as string);
    void bot;
    match.start();

    const events = captureLogs(() => {
      runTicks(match, 20000, () => match.sim!.getFighter(0).stocks <= 1);
    });

    const stockLosses = events.filter((e) => e.evt === 'stockLoss' && e.slot === 0);
    assert.equal(stockLosses.length, 1, 'exactly one stockLoss for the human seat first death');
    const sl = stockLosses[0]!;
    assert.equal(sl.isBot, false);
    assert.equal(sl.stocksRemaining, 1);
    assert.equal(sl.matchId, 'stockloss-test-1');
    assert.ok('cause' in sl && 'attacker' in sl && 'percentAtDeath' in sl && 'tick' in sl && 'matchAgeSec' in sl);
    assert.equal(events.filter((e) => e.evt === 'elimination' && e.slot === 0).length, 0, 'first death must not eliminate');
    assert.equal(eliminatedCalls, 0, 'onEliminated must not fire for a mere stock loss');
    assert.equal(match.sim!.getFighter(0).eliminated, false, 'seat must still be alive to keep playing');
    assert.equal(match.sim!.getFighter(0).stocks, 1, 'exactly one stock remains');
  } finally {
    delete process.env.MATCH_WIN_CONDITION;
    delete process.env.MATCH_STARTING_STOCKS;
    delete process.env.MATCH_SHRINK_FULLY_CLOSED_TICK;
  }
});

test('stocks mode: human seat second death eliminates with a placement, emits elimination and no stockLoss', () => {
  process.env.MATCH_WIN_CONDITION = 'stocks';
  process.env.MATCH_STARTING_STOCKS = '2';
  process.env.MATCH_SHRINK_FULLY_CLOSED_TICK = '90';
  try {
    let placementSeen: number | null = null;
    const match = new Match('stockloss-test-2', 2, 1, noopEvents((slot, placement) => {
      if (slot === 0) placementSeen = placement;
    }));
    match.addSeat('human-a', false);
    match.addSeat('bot-1', true);
    match.start();

    const events = captureLogs(() => {
      runTicks(match, 40000, () => match.sim!.getFighter(0).eliminated);
    });

    assert.equal(match.sim!.getFighter(0).eliminated, true, 'second death must eliminate the seat');
    const eliminations = events.filter((e) => e.evt === 'elimination' && e.slot === 0);
    assert.equal(eliminations.length, 1, 'exactly one elimination event for the human seat');
    assert.ok(typeof eliminations[0]!.placement === 'number' && (eliminations[0]!.placement as number) > 0);
    assert.equal(placementSeen !== null && placementSeen > 0, true, 'onEliminated must report a real placement');
    const stockLossesAfterSecondDeath = events.filter((e) => e.evt === 'stockLoss' && e.slot === 0);
    assert.equal(stockLossesAfterSecondDeath.length, 1, 'the earlier first-death stockLoss is still the only one; the second death is a real elimination, not a stockLoss');
  } finally {
    delete process.env.MATCH_WIN_CONDITION;
    delete process.env.MATCH_STARTING_STOCKS;
    delete process.env.MATCH_SHRINK_FULLY_CLOSED_TICK;
  }
});

test('battleRoyale mode never emits stockLoss (startingStocks is forced to 1, first death eliminates)', () => {
  process.env.MATCH_WIN_CONDITION = 'battleRoyale';
  process.env.MATCH_SHRINK_FULLY_CLOSED_TICK = '90';
  try {
    const match = new Match('stockloss-test-3', 2, 1, noopEvents());
    match.addSeat('human-a', false);
    match.addSeat('bot-1', true);
    match.start();

    const events = captureLogs(() => {
      runTicks(match, 40000, () => match.sim!.isMatchOver());
    });

    assert.equal(events.filter((e) => e.evt === 'stockLoss').length, 0, 'battleRoyale must never emit stockLoss');
  } finally {
    delete process.env.MATCH_WIN_CONDITION;
    delete process.env.MATCH_SHRINK_FULLY_CLOSED_TICK;
  }
});
