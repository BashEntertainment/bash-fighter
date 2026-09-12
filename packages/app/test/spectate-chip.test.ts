// 2026-09-12: the spectate escape hatch used to force the player's whole
// placement overlay back on screen every 25 seconds while the match was
// still running, so a player who had explicitly chosen "Keep spectating"
// had a panel thrown over the fight again and again (and a click aimed at
// the game could land on a button that had just reappeared). The hatch is
// now a small, permanent "Play again" chip. No jsdom is available here (see
// "Sim Core Implementation Notes"), so the wiring is pinned at source level
// -- that wiring is exactly what regressed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
const chip = readFileSync(new URL('../src/ui/spectate-chip.ts', import.meta.url), 'utf8');

test('the chip offers exactly one Play again control and starts hidden', () => {
  assert.match(chip, /className = 'spectate-chip hidden'/);
  assert.equal(chip.match(/createElement\('button'\)/g)?.length, 1);
  assert.match(chip, /textContent = 'Play again'/);
});

test('the spectate stall timer shows the chip, never the placement overlay', () => {
  const timer = main.slice(main.indexOf('spectateStallTimer = setInterval'));
  const body = timer.slice(0, timer.indexOf('SPECTATE_STALL_MS)'));
  assert.match(body, /spectateChip\.show\(\)/);
  assert.doesNotMatch(body, /matchOverlay\.show/);
});

test('choosing to keep spectating hides the overlay and reveals the chip', () => {
  const idx = main.indexOf("label: 'Keep spectating'");
  assert.ok(idx > 0);
  const action = main.slice(idx, idx + 260);
  assert.match(action, /matchOverlay\.hide\(\)/);
  assert.match(action, /spectateChip\.show\(\)/);
});

test('the chip is cleared whenever a match starts or ends', () => {
  // Starting a new online match, a resolved match, and the unresolved
  // "Match ended" path must all take the chip away: it is only meaningful
  // while a match the player was eliminated from is still running.
  assert.ok(main.match(/spectateChip\.hide\(\)/g)!.length >= 4);
  const begin = main.slice(main.indexOf('async function beginOnlineMatch'));
  assert.match(begin.slice(0, 600), /spectateChip\.hide\(\)/);
});
