// Regression for a real production bug (2026-09-11): clicking "Play
// online" could land a brand-new player straight on an already-finished
// match's result screen. Root cause: NetMatch.connect() unconditionally
// offered a resumeToken left in sessionStorage from a previous session
// whenever one was present, even though connect() is only ever invoked
// by an explicit "Play online"/"Play again" click -- never by the
// automatic mid-drop reconnect path (scheduleReconnect() calls
// openSocket() directly and is untouched by this). The server dutifully
// honoured that token: if the match it named had already ended, it
// replied with a `matchEnd` (logged server-side as
// `path: "resume-into-ended"`) instead of putting the player in a lobby.
//
// This can't exercise a live NetMatch (no real socket in `npm test`), so
// it pins the fix at the source level: connect() must clear the stored
// resume token before ever opening a socket, so its first 'hello' can
// never carry a stale one.
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
  // Grab up to the next top-level method start (two-space-indented method
  // or closing brace of the class) -- good enough for a source-text pin.
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

test('connect() clears the stored resume token before opening a socket', () => {
  const connectBody = bodyOf('connect(name: string, characterId');
  const clearIdx = connectBody.indexOf('this.setResumeToken(null)');
  const openIdx = connectBody.indexOf('this.openSocket()');
  assert.ok(clearIdx >= 0, 'connect() must clear the resume token');
  assert.ok(openIdx >= 0, 'connect() must open the socket');
  assert.ok(clearIdx < openIdx, 'the resume token must be cleared BEFORE the socket (and its hello) is opened');
});

test('automatic mid-match reconnect (scheduleReconnect) is untouched: it does not clear the resume token', () => {
  const reconnectBody = bodyOf('private scheduleReconnect()');
  assert.ok(
    !reconnectBody.includes('setResumeToken(null)'),
    'scheduleReconnect() must keep offering the live session token so an accidental drop mid-match can still resume',
  );
  assert.ok(reconnectBody.includes('this.openSocket()'), 'scheduleReconnect() must still call openSocket() directly (not connect())');
});
