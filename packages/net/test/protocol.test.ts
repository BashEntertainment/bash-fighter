import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  encodeInput,
  decodeInput,
  encodeSnapshot,
  decodeSnapshot,
  parseClientControl,
  sanitiseName,
  dedupeName,
  PROTOCOL_VERSION,
  INPUT_FRAME_BYTES,
} from '../src/protocol.ts';

describe('input frame encode/decode', () => {
  test('round-trips a normal frame', () => {
    const wire = { tick: 12345, buttons: 0b1011, stickX: 65536, stickY: -32768 };
    const bytes = encodeInput(wire);
    assert.equal(bytes.byteLength, INPUT_FRAME_BYTES);
    const decoded = decodeInput(bytes);
    assert.deepEqual(decoded, wire);
  });

  test('rejects wrong-length buffers', () => {
    assert.equal(decodeInput(new Uint8Array(3)), null);
    assert.equal(decodeInput(new Uint8Array(INPUT_FRAME_BYTES + 1)), null);
  });

  test('rejects a buffer with the wrong tag byte', () => {
    const bytes = encodeInput({ tick: 1, buttons: 0, stickX: 0, stickY: 0 });
    bytes[0] = 99;
    assert.equal(decodeInput(bytes), null);
  });
});

describe('snapshot encode/decode', () => {
  test('round-trips header and state words', () => {
    const state = new Int32Array([1, -2, 3, -400000, 0]);
    const wire = { tick: 999, ackedInputTick: 998, state };
    const bytes = encodeSnapshot(wire);
    const decoded = decodeSnapshot(bytes);
    assert.ok(decoded);
    assert.equal(decoded!.tick, 999);
    assert.equal(decoded!.ackedInputTick, 998);
    assert.deepEqual(Array.from(decoded!.state), Array.from(state));
  });

  test('round-trips an empty state buffer', () => {
    const bytes = encodeSnapshot({ tick: 1, ackedInputTick: 0, state: new Int32Array(0) });
    const decoded = decodeSnapshot(bytes);
    assert.equal(decoded!.state.length, 0);
  });

  test('rejects a payload that is not a whole number of 4-byte words', () => {
    const bytes = encodeSnapshot({ tick: 1, ackedInputTick: 0, state: new Int32Array([1]) });
    const truncated = bytes.slice(0, bytes.length - 1);
    assert.equal(decodeSnapshot(truncated), null);
  });
});

describe('parseClientControl', () => {
  test('parses a valid hello', () => {
    const msg = parseClientControl(JSON.stringify({ t: 'hello', protocolVersion: PROTOCOL_VERSION, name: 'Alice' }));
    assert.deepEqual(msg, { t: 'hello', protocolVersion: PROTOCOL_VERSION, name: 'Alice' });
  });

  test('rejects malformed JSON', () => {
    assert.equal(parseClientControl('{not json'), null);
  });

  test('rejects an unknown message type', () => {
    assert.equal(parseClientControl(JSON.stringify({ t: 'nonsense' })), null);
  });

  test('rejects an oversized frame', () => {
    const huge = JSON.stringify({ t: 'hello', protocolVersion: 1, name: 'x'.repeat(10_000) });
    assert.equal(parseClientControl(huge), null);
  });

  test('parses spectate and pong', () => {
    assert.deepEqual(parseClientControl(JSON.stringify({ t: 'spectate' })), { t: 'spectate' });
    assert.deepEqual(parseClientControl(JSON.stringify({ t: 'pong', id: 7 })), { t: 'pong', id: 7 });
  });
});

describe('sanitiseName', () => {
  test('strips control characters and truncates to 16', () => {
    assert.equal(sanitiseName('Al\u0000ice\u007fLongLongLongName'), 'AliceLongLongLon');
  });

  test('returns empty for an empty/whitespace-only name, not a forced placeholder', () => {
    assert.equal(sanitiseName('   '), '');
    assert.equal(sanitiseName(''), '');
    assert.equal(sanitiseName('\u0000\u0001\u0007'), '');
  });

  test('collapses interior whitespace runs (tabs, newlines-as-control-chars)', () => {
    assert.equal(sanitiseName('Rook   the   Second'), 'Rook the Second');
  });

  test('strips a script tag down to inert text, never markup', () => {
    // Control characters are stripped but '<'/'>' are ordinary printable
    // characters here -- they are never treated as markup because every
    // renderer in the app writes names via textContent/PIXI Text, never
    // innerHTML. sanitiseName's job is length/control-character hygiene,
    // not HTML escaping (there is nothing that would ever parse this).
    assert.equal(sanitiseName('<script>alert(1)</script>'), '<script>alert(1)');
  });

  test('a 500-character name is capped to 16', () => {
    const huge = 'x'.repeat(500);
    assert.equal(sanitiseName(huge).length, 16);
  });

  test('rejects a lone all-whitespace name including unicode spaces', () => {
    assert.equal(sanitiseName('\u00a0\u2003\t\n'), '');
  });
});

describe('dedupeName', () => {
  test('leaves a unique name untouched', () => {
    assert.equal(dedupeName('Rook', ['Anchor', 'Zephyr']), 'Rook');
  });

  test('appends a counter suffix on collision, case-insensitively', () => {
    assert.equal(dedupeName('rook', ['Rook']), 'rook (2)');
    assert.equal(dedupeName('Rook', ['Rook', 'Rook (2)']), 'Rook (3)');
  });

  test('never dedupes an empty name -- it carries no identity to collide on', () => {
    assert.equal(dedupeName('', ['', '', '']), '');
  });

  test('keeps the deduped result within MAX_NAME_LENGTH', () => {
    const long = 'AAAAAAAAAAAAAAAA'; // exactly 16 chars
    const result = dedupeName(long, [long]);
    assert.ok(result.length <= 16, `expected <=16 chars, got "${result}" (${result.length})`);
    assert.notEqual(result, long);
  });
});
