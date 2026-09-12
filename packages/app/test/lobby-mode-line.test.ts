// Client-side coverage for the lobby mode line (2026-09-11, Timed Brawl
// mode rotation): a waiting player must be told which mode they are
// about to play, in plain language, never the raw internal identifier
// ('timedKO'/'battleRoyale'). Follows the source-inspection pattern used
// by net-match-hazard-audio-parity.test.ts -- main.ts is the app entry
// point wired to a live DOM/WebSocket and not easily unit-tested in
// isolation, so this pins the wiring precisely instead: the protocol
// field exists, net-match.ts forwards it, and main.ts renders it without
// ever hardcoding an internal identifier into the DOM.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const mainSrc = readFileSync(join(here, '../src/main.ts'), 'utf8');
const netMatchSrc = readFileSync(join(here, '../src/net-match.ts'), 'utf8');
const protocolSrc = readFileSync(join(here, '../../net/src/protocol.ts'), 'utf8');

test('LobbyMessage carries a modeName field for clients to display', () => {
  assert.ok(protocolSrc.includes('modeName'), 'protocol.ts LobbyMessage must carry a modeName field');
});

test('net-match.ts forwards modeName from the lobby message to onLobby', () => {
  assert.match(netMatchSrc, /onLobby\?\([^)]*modeName/, 'onLobby event signature must include modeName');
  assert.match(
    netMatchSrc,
    /onLobby\?\.\(msg\.players,\s*msg\.capacity,\s*msg\.countdownTicks,\s*msg\.modeName\)/,
    'the lobby handler must actually pass msg.modeName through, not just declare it',
  );
});

test('main.ts renders modeName into a dedicated mode line and hides it when absent', () => {
  assert.ok(mainSrc.includes('net-mode-line'), 'a dedicated mode-line element must exist');
  assert.match(
    mainSrc,
    /onLobby:\s*\([^)]*modeName[^)]*\)\s*=>/,
    'the onLobby callback must accept modeName',
  );
  assert.ok(
    mainSrc.includes('netModeLine.textContent = modeName'),
    'the mode line must render the server-provided plain-language text verbatim',
  );
});

test('main.ts never hardcodes the internal winCondition identifiers into player-facing text', () => {
  // Regression guard for the exact mistake the brief calls out: printing
  // 'timedKO' at the player instead of a human-readable line. The
  // identifiers may appear in code (e.g. type unions, comments) but must
  // never be embedded directly in a rendered string literal that could
  // reach the DOM as-is.
  assert.ok(
    !/textContent\s*=\s*['"`][^'"`]*timedKO/.test(mainSrc),
    'must not assign a string containing the raw "timedKO" identifier to textContent',
  );
});
