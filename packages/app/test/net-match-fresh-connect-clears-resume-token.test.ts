// Regression coverage for two rounds of the same real production bug
// (2026-09-11):
//
//   Round 1: clicking "Play online" could land a brand-new player
//   straight on an already-finished match's result screen. Root cause:
//   a resumeToken left in sessionStorage by a session that never got the
//   chance to clear it (its socket died before 'eliminated' or
//   'matchEnd' -- the two places that already clear it -- could run) was
//   offered on the very next connect(), and the server, offered a token
//   for a match that had already ended, dutifully replied via its
//   documented resume-into-ended path (server logs
//   `path: "resume-into-ended"`).
//
//   Round 1's fix (blanket-clearing the token in connect()) traded that
//   defect for another: a player who hits browser refresh mid-match,
//   relying on exactly this token to drop them back into the live match
//   they were winning, got silently dumped into a fresh lobby instead.
//   Offering the token from connect() is legitimate and must stay; only
//   a *stale* token (one that resolves to an already-ended match) is the
//   problem, and that only becomes knowable when the server's welcome
//   for a resume attempt comes back paired with the matching matchEnd --
//   so that is where this is now handled, in handleControl.
//
// This can't exercise a live NetMatch (no real socket in `npm test`), so
// it pins the fix at the source level.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, '../src/net-match.ts'), 'utf8');

function bodyOf(methodSignature: string): string {
  const start = src.indexOf(methodSignature);
  assert.ok(start >= 0, `expected to find ${methodSignature} in net-match.ts`);
  const openBrace = src.indexOf('{', start);
  let depth = 0;
  let i = openBrace;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      depth--;
      if (depth === 0) break;
    }
  }
  return src.slice(start, i + 1);
}

function caseOf(body: string, caseLabel: string): string {
  const start = body.indexOf(caseLabel);
  assert.ok(start >= 0, `expected to find ${caseLabel} in the switch body`);
  const nextCase = body.slice(start + caseLabel.length).search(/\n\s*case '/);
  const end = nextCase >= 0 ? start + caseLabel.length + nextCase : body.length;
  return body.slice(start, end);
}

test('connect() still offers a stored resume token (a mid-match refresh must still resume the live match)', () => {
  const connectBody = bodyOf('connect(name: string, characterId');
  assert.ok(
    !connectBody.includes('this.setResumeToken(null)'),
    'connect() must NOT blanket-clear the resume token -- that is what let a refresh mid-match resume the live match, and must keep working',
  );
  assert.ok(connectBody.includes('this.openSocket()'), 'connect() must still open a socket, which is what offers this.resumeToken via the hello message');
});

test("handleControl's 'welcome' case detects the resume-into-ended signal (resumed === true with a null resumeToken)", () => {
  const handleControlBody = bodyOf('private handleControl(msg: ServerControlMessage)');
  const welcomeCase = caseOf(handleControlBody, "case 'welcome':");
  assert.match(
    welcomeCase,
    /resumedIntoEndedMatch\s*=\s*msg\.resumed === true && \(msg\.resumeToken \?\? null\) === null/,
    'welcome must flag resumed:true + resumeToken:null as the resume-into-ended case -- the one combination server/src/index.ts only ever sends on that path',
  );
});

test("handleControl's 'matchEnd' case clears the token and opens a fresh connection instead of surfacing a result, when resumed-into-ended", () => {
  const handleControlBody = bodyOf('private handleControl(msg: ServerControlMessage)');
  const matchEndCase = caseOf(handleControlBody, "case 'matchEnd':");
  const clearIdx = matchEndCase.indexOf('this.setResumeToken(null)');
  const branchIdx = matchEndCase.indexOf('if (this.resumedIntoEndedMatch)');
  const connectIdx = matchEndCase.indexOf('this.connect(this.name, this.characterId)');
  const overIdx = matchEndCase.indexOf('this.over = true');
  const onMatchOverIdx = matchEndCase.indexOf('this.events.onMatchOver?.(');
  assert.ok(clearIdx >= 0, 'matchEnd must clear the (now-dead) resume token');
  assert.ok(branchIdx >= 0 && branchIdx > clearIdx, 'matchEnd must branch on resumedIntoEndedMatch after clearing the token');
  assert.ok(connectIdx >= 0 && connectIdx > branchIdx, 'the resumed-into-ended branch must open a fresh connection (connect()), not show a result');
  assert.ok(
    overIdx > connectIdx && onMatchOverIdx > connectIdx,
    'the real result path (this.over = true / onMatchOver) must sit after the early-return branch, so it never runs for a stale resume',
  );
});

test('automatic mid-match reconnect (scheduleReconnect) is untouched: it still offers the live session token via openSocket()', () => {
  const reconnectBody = bodyOf('private scheduleReconnect()');
  assert.ok(reconnectBody.includes('this.openSocket()'), 'scheduleReconnect() must still call openSocket() directly (not connect()), keeping this.resumeToken live for the retry');
});

test("a socket superseded by a fresh connect() cannot report stale 'disconnected'/'error' state (close/error listeners are guarded by identity)", () => {
  const openSocketBody = bodyOf('private openSocket()');
  assert.match(
    openSocketBody,
    /addEventListener\('close', \(\) => \{\s*\/\/[^]*?if \(ws !== this\.ws\) return;/,
    "the 'close' listener must bail out if its socket is no longer this.ws (superseded by a newer connection, e.g. the resume-into-ended retry)",
  );
  assert.match(
    openSocketBody,
    /addEventListener\('error', \(\) => \{\s*if \(ws !== this\.ws\) return;/,
    "the 'error' listener must bail out if its socket is no longer this.ws",
  );
});
