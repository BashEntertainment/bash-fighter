import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  encodeInput,
  decodeInput,
  encodeSnapshot,
  decodeSnapshot,
  parseClientControl,
  sanitiseName,
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

  test('falls back to Fighter for an empty/whitespace name', () => {
    assert.equal(sanitiseName('   '), 'Fighter');
    assert.equal(sanitiseName(''), 'Fighter');
  });
});
