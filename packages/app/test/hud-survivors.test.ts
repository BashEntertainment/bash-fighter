// Regression test for a real production bug seen live: at the moment a
// match resolves, the HUD sidebar still read e.g. "2 / 20 remaining"
// while only one fighter was actually alive, alongside the match-end
// overlay already announcing the winner.
//
// Root cause, proved by reading the code rather than guessing: onMatchOver
// (main.ts) does call hud.hide() the instant the match ends, on both the
// online (NetMatch) and local (Match) paths. But main.ts's own HUD tick
// loops (onlineHudTick / hudTick) run every animation frame independently
// via requestAnimationFrame, gated only on `netMatch.hasStarted()` /
// `match && adapter` -- neither of which ever goes false again once a
// match has begun. So the very next animation frame after onMatchOver's
// hud.hide(), the tick loop called hud.show() again and re-rendered the
// HUD from currentSnapshots(), which for NetMatch is the last *state*
// snapshot applied locally -- one elimination behind the *matchEnd*
// control message that had already fired the winner overlay, since the
// two travel as separate messages and the control message can be
// processed first. That is the exact "one elimination behind" symptom.
//
// The fix adds Match.isOver()/NetMatch.isOver() (mirroring the `over`
// flag both classes already track for tick()/handleControl()) and gates
// both tick loops on it, so nothing can ever re-show a HUD frame after
// the match has ended. This file pins that gate by source inspection
// (no jsdom -- see match-overlay.test.ts) plus a pure unit test on the
// survivors-line wording itself so the count text can't silently drift.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { survivorsLineText } from '../src/ui/hud-text.ts';

const here = dirname(fileURLToPath(import.meta.url));
const mainSrc = readFileSync(join(here, '../src/main.ts'), 'utf8');
const matchSrc = readFileSync(join(here, '../src/match.ts'), 'utf8');
const netMatchSrc = readFileSync(join(here, '../src/net-match.ts'), 'utf8');

test('Match and NetMatch expose isOver()', () => {
  assert.ok(matchSrc.includes('isOver(): boolean'), 'match.ts must expose isOver() so main.ts can stop re-showing the HUD after match end');
  assert.ok(netMatchSrc.includes('isOver(): boolean'), 'net-match.ts must expose isOver() so main.ts can stop re-showing the HUD after match end');
});

test('the online HUD tick loop stops updating once the match is over', () => {
  assert.match(
    mainSrc,
    /netMatch\s*&&\s*netMatch\.hasStarted\(\)\s*&&\s*!netMatch\.isOver\(\)/,
    'onlineHudTick must check !netMatch.isOver() -- hasStarted() alone never reverts to false, ' +
      'which is exactly what let a stale HUD frame reappear one tick after onMatchOver had already hidden it',
  );
});

test('the local HUD tick loop stops updating once the match is over', () => {
  assert.match(
    mainSrc,
    /match\s*&&\s*adapter\s*&&\s*!match\.isOver\(\)/,
    'hudTick must check !match.isOver() for the same reason as the online path',
  );
});

test('survivorsLineText shows the count for a real multi-fighter battle royale', () => {
  assert.equal(survivorsLineText(2, 20, false), '2 / 20 remaining');
});

test('survivorsLineText is blank for Timed Brawl regardless of survivor count', () => {
  assert.equal(survivorsLineText(2, 20, true), '');
});

test('survivorsLineText is blank for 1v1 (only shown once there is a crowd to track)', () => {
  assert.equal(survivorsLineText(1, 2, false), '');
});

test('survivorsLineText reflects a match that has resolved to one survivor', () => {
  // The exact shape of the bug report: by the time the match is over,
  // survivors must read 1, not a stale 2.
  assert.equal(survivorsLineText(1, 20, false), '1 / 20 remaining');
});
