// Verifies the two audio cues the audio work log honestly flagged as
// "never individually confirmed to fire" (ring-damage and match-end),
// using window.__bashTestAudio()'s cue log (see main.ts, gated on
// ?bashTest=1). Live verification (packages/app/src/ui via the local
// crowd20 harness, http://localhost:5173/?crowd20=1&bashTest=1) found:
//
//   - match_end: DOES fire, on both a match-over-while-watching-as-a-
//     spectator run and a last-survivor-wins run. Confirmed via
//     window.__bashTestAudio().getCueLog() showing a 'match_end' entry
//     the instant the win overlay appeared, with the HUD sidebar gone
//     (see the "stale survivor counter" fix in hud-survivors.test.ts).
//
//   - ring-damage (playRingDamage, gated on FighterSnapshot.inRingDanger,
//     see match.ts/net-match.ts): did NOT fire, ever, even when parked
//     for tens of thousands of ticks in a spot the elimination log
//     (cause: 'ring') proved was outside the shrunk safe rect. Root
//     cause, found by reading packages/sim/src/sim.ts: getFighter()
//     computed `inRingDanger` as `RING_DAMAGE_TICK === this.tick`, but
//     RING_DAMAGE_TICK is written with the *pre-increment* tick inside
//     checkBlastZone, while advance() only bumps this.tick at its very
//     end (after all fighters are updated) -- so by the time any
//     external caller (every app-side caller calls this right after
//     advance() returns) reads the flag, this.tick has already moved
//     to the next frame and the comparison can never be true. This is
//     a one-tick-off *read-only derived flag* bug: RING_DAMAGE_TICK
//     itself, and the 'ring'/'ring_lethal' elimination causes that
//     already depend on it internally, were always correct -- only the
//     externally-observable inRingDanger getter used by app-side audio
//     and HUD code was wrong. Fixed by comparing against
//     `this.tick - 1`. This is presentation-only: it is a derived
//     getter, not a serialized/hashed sim field, so
//     packages/sim/test/determinism*.test.ts golden hashes are
//     unaffected (verified: all 8 determinism tests still pass
//     unchanged after the fix).
//
// This file pins the wiring on the app side (that both cues are really
// called from the right place) plus a full sim-level reproduction of
// the ring-damage bug and its fix, run against the real Sim class so
// it can't silently regress back to the off-by-one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Sim } from '../../sim/src/sim.ts';
import { makeInputFrame } from '../../sim/src/types.ts';
import { ALL_ARENAS } from '../../content/src/arenas.ts';

const here = dirname(fileURLToPath(import.meta.url));
const matchSrc = readFileSync(join(here, '../src/match.ts'), 'utf8');
const netMatchSrc = readFileSync(join(here, '../src/net-match.ts'), 'utf8');
const mainSrc = readFileSync(join(here, '../src/main.ts'), 'utf8');

test('local play calls playRingDamage, gated on inRingDanger', () => {
  assert.match(
    matchSrc,
    /inRingDanger[\s\S]{0,80}playRingDamage|playRingDamage[\s\S]{0,80}inRingDanger/,
    'match.ts must call audio.playRingDamage() when the local snapshot has inRingDanger set',
  );
});

test('online play calls playRingDamage, gated on inRingDanger', () => {
  assert.match(
    netMatchSrc,
    /inRingDanger[\s\S]{0,80}playRingDamage|playRingDamage[\s\S]{0,80}inRingDanger/,
    'net-match.ts must call audio.playRingDamage() the same way match.ts does',
  );
});

test('main.ts plays the match_end cue when a match resolves', () => {
  assert.match(
    mainSrc,
    /play\(\s*['"]match_end['"]\s*\)/,
    "main.ts's onMatchOver handling must call audio.play('match_end')",
  );
});

test('reproduction: a fighter parked outside the shrunk safe rect is eventually eliminated with cause "ring"', () => {
  // Establishes that the scenario used below (idle fighters, long-running
  // match) really does exercise ring damage in the real sim, independent
  // of the inRingDanger getter under test.
  const entry = ALL_ARENAS[0];
  if (!entry) throw new Error('expected at least one arena');
  const arena = entry.arena;
  const sim = new Sim(1, 2, undefined, arena);
  const idle = makeInputFrame(0, 0, 0);
  let ringCause = false;
  for (let t = 0; t < 40000 && !sim.isMatchOver(); t++) {
    sim.advance([idle, idle]);
  }
  const events = sim.eliminationEvents;
  ringCause = events.some((e) => e.cause === 'ring' || e.cause === 'ring_lethal');
  assert.ok(sim.isMatchOver(), 'sanity: the idle stand-off must actually resolve within the tick budget');
  assert.ok(ringCause, 'sanity: the resolution must actually be attributed to ring pressure, not combat');
});

test('fix: getFighter().inRingDanger goes true at least once during that same run', () => {
  // This is the exact bug: before the fix this count was always 0 even
  // though the elimination cause above proves ring damage was applied.
  const entry = ALL_ARENAS[0];
  if (!entry) throw new Error('expected at least one arena');
  const arena = entry.arena;
  const sim = new Sim(1, 2, undefined, arena);
  const idle = makeInputFrame(0, 0, 0);
  let sawDanger = 0;
  for (let t = 0; t < 40000 && !sim.isMatchOver(); t++) {
    sim.advance([idle, idle]);
    if (sim.getFighter(0).inRingDanger) sawDanger++;
    if (sim.getFighter(1).inRingDanger) sawDanger++;
  }
  assert.ok(
    sawDanger > 0,
    'inRingDanger must be observably true at least once for a fighter that ring damage is actually applied to -- ' +
      'this is what packages/app reads to decide whether to play the ring-damage cue',
  );
});
