// Regression test for a real production bug: the online-play adapter
// (net-match.ts) mirrors match.ts (local play) for hit/elimination/
// ring-damage audio, but the edge/boundary "hazard warning" chirp
// (playHazardWarning, debounced via an edgeDangerSounding flag) was
// only ever wired up in match.ts. Since production serves NetMatch for
// every online match, every real player-facing match was silently
// missing this cue. This test doesn't spin up a full NetMatch (that
// needs a live socket), but it pins the wiring so it can't silently
// regress again: net-match.ts must reference the same audio call and
// debounce field that match.ts already uses successfully.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const netMatchSrc = readFileSync(join(here, '../src/net-match.ts'), 'utf8');
const matchSrc = readFileSync(join(here, '../src/match.ts'), 'utf8');

test('net-match wires playHazardWarning the same way match.ts does', () => {
  assert.ok(matchSrc.includes('playHazardWarning'), 'sanity: match.ts still has the local-play hazard cue');
  assert.ok(
    netMatchSrc.includes('playHazardWarning'),
    'net-match.ts (the online-play adapter production actually serves) must also call playHazardWarning -- ' +
      'without it, every real player never hears the boundary-danger cue at all',
  );
});

test('net-match debounces the hazard cue on a threshold crossing, not every tick', () => {
  assert.ok(
    netMatchSrc.includes('edgeDangerSounding'),
    'net-match.ts must track edgeDangerSounding (or equivalent) so the cue fires once per crossing, ' +
      'mirroring match.ts, instead of re-triggering every tick while in danger',
  );
});

test('net-match computes danger via the shared computeEdgeDangerFrac helper', () => {
  assert.ok(
    netMatchSrc.includes('computeEdgeDangerFrac'),
    'net-match.ts should reuse the same edge-danger calculation as match.ts and the HUD ring, ' +
      'not a bespoke one that could drift out of sync',
  );
});
