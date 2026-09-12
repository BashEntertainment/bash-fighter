// The composed waiting screen (packages/app/src/ui/waiting-screen.ts) shows
// the mode line and player count itself; the small always-on #net-status
// and #net-mode-line chips used to keep showing the exact same two
// sentences underneath it, making the waiting screen look unconsidered
// (duplicated information). This pins that they are suppressed for
// exactly the 'waiting' net state and stay untouched for every other one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, '../src/style.css'), 'utf8');

test("#net-status and #net-mode-line are both suppressed specifically when data-state='waiting'", () => {
  assert.match(
    css,
    /#net-status\[data-state='waiting'\],\s*#net-status\[data-state='waiting'\]\s*~\s*#net-mode-line\s*\{\s*display:\s*none;\s*\}/,
    'expected a single rule keyed off data-state=\'waiting\' hiding both #net-status and its sibling #net-mode-line',
  );
});

test('no state other than waiting is targeted by a chip-hiding rule (every other state keeps both chips)', () => {
  const otherStates = ['connecting', 'in-match', 'spectating', 'match-complete', 'disconnected', 'reconnecting', 'error'];
  for (const state of otherStates) {
    const hidingRule = new RegExp(`#net-status\\[data-state='${state}'\\][^{]*\\{[^}]*display:\\s*none;`);
    assert.ok(!hidingRule.test(css), `state '${state}' must not have a display:none rule -- its chips must stay visible exactly as before`);
  }
});
