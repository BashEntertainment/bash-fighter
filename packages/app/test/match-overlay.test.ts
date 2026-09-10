// Regression test for the 2026-09-10 stranded-spectator bug (see wiki
// "Client-Server Match Divergence 2026-09-10" and "Match-End Client Bugs
// and Session Wrap 2026-09-09"): a player already eliminated who kept
// watching a match that genuinely resolved was told nothing at all --
// onMatchOver's `if (eliminatedThisOnlineMatch) return;` swallowed the
// resolved case unconditionally. The fix threads the winner into the
// placement overlay's message via announceWinner/winnerAnnouncementLine.
//
// No jsdom here (npm registry is blocked for agents -- see "Sim Core
// Implementation Notes"), so this covers the pure text logic directly
// rather than building a DOM shim for innerHTML/querySelector: the text
// composition is exactly what was missing, and it is fully testable
// without a DOM.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { winnerAnnouncementLine } from '../src/ui/match-overlay.ts';

test('winnerAnnouncementLine names the winning slot for a watching spectator', () => {
  // Eliminated 6th, watched slot 16 win: this is the exact case from the
  // divergence report that shipped with no announcement at all.
  const line = winnerAnnouncementLine(16, null);
  assert.match(line, /#17/); // slot is 0-based on the wire, 1-based on screen
  assert.match(line, /won/);
});

test('winnerAnnouncementLine tells the player when they themselves won', () => {
  const line = winnerAnnouncementLine(4, 4);
  assert.match(line, /you won/i);
});

test('winnerAnnouncementLine handles a match with no winner (mass wipe)', () => {
  const line = winnerAnnouncementLine(null, 4);
  assert.match(line, /no winner/);
});

test('winnerAnnouncementLine does not claim victory for an uninvolved local slot', () => {
  const line = winnerAnnouncementLine(4, 7);
  assert.doesNotMatch(line, /you won/i);
  assert.match(line, /#5/);
});
