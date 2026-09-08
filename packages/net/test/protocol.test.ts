import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PROTOCOL_VERSION,
  INPUT_FRAME_BYTES,
  SNAPSHOT_HEADER_BYTES,
  encodeInput,
  decodeInput,
  encodeSnapshot,
  decodeSnapshot,
  parseClientControl,
  sanitiseName,
} from '../src/protocol.ts';

test('input round-trips exactly, including negative stick values', () => {
  const input = { tick: 123456, buttons: 0b1010_0101, stickX: -32768, stickY: 65536 };
  const bytes = encodeInput(input);
  assert.equal(bytes.byteLength, INPUT_FRAME_BYTES);
  assert.deepEqual(decodeInput(bytes), input);
});

test('input decode rejects malformed frames instead of guessing', () => {
  assert.equal(decodeInput(new Uint8Array(0)), null);
  assert.equal(decodeInput(new Uint8Array(INPUT_FRAME_BYTES - 1)), null);
  assert.equal(decodeInput(new Uint8Array(INPUT_FRAME_BYTES + 1)), null);
  // Right length, wrong tag: this is a snapshot-tagged frame arriving on the
  // input path, which must not be silently accepted.
  const wrongTag = encodeInput({ tick: 1, buttons: 0, stickX: 0, stickY: 0 });
  wrongTag[0] = 99;
  assert.equal(decodeInput(wrongTag), null);
});

test('snapshot round-trips the full state buffer', () => {
  const state = new Int32Array([0, 1, -1, 2147483647, -2147483648, 65536, -65536]);
  const bytes = encodeSnapshot({ tick: 900, ackedInputTick: 890, state });
  assert.equal(bytes.byteLength, SNAPSHOT_HEADER_BYTES + state.length * 4);
  const decoded = decodeSnapshot(bytes);
  assert.ok(decoded);
  assert.equal(decoded.tick, 900);
  assert.equal(decoded.ackedInputTick, 890);
  assert.deepEqual(Array.from(decoded.state), Array.from(state));
});

test('snapshot decode rejects a truncated word', () => {
  const state = new Int32Array([1, 2, 3]);
  const bytes = encodeSnapshot({ tick: 1, ackedInputTick: 0, state });
  assert.equal(decodeSnapshot(bytes.subarray(0, bytes.byteLength - 1)), null);
  assert.equal(decodeSnapshot(new Uint8Array(4)), null);
});

test('snapshot encoding is little-endian regardless of host byte order', () => {
  // Guards against using a typed-array view over the buffer, which would
  // silently inherit the host's endianness and desync a big-endian server.
  const bytes = encodeSnapshot({ tick: 0, ackedInputTick: 0, state: new Int32Array([1]) });
  assert.deepEqual(Array.from(bytes.subarray(SNAPSHOT_HEADER_BYTES)), [1, 0, 0, 0]);
});

test('hello is accepted and its name sanitised', () => {
  const msg = parseClientControl(
    JSON.stringify({ t: 'hello', protocolVersion: PROTOCOL_VERSION, name: '  Ada  ' }),
  );
  assert.deepEqual(msg, { t: 'hello', protocolVersion: PROTOCOL_VERSION, name: 'Ada' });
});

test('control parsing rejects hostile input without throwing', () => {
  assert.equal(parseClientControl('not json'), null);
  assert.equal(parseClientControl('null'), null);
  assert.equal(parseClientControl('[]'), null);
  assert.equal(parseClientControl('"a string"'), null);
  assert.equal(parseClientControl(JSON.stringify({ t: 'unknown' })), null);
  assert.equal(parseClientControl(JSON.stringify({ t: 'hello', name: 'x' })), null);
  assert.equal(parseClientControl(JSON.stringify({ t: 'hello', protocolVersion: 1 })), null);
  assert.equal(parseClientControl(JSON.stringify({ t: 'pong', id: 'nope' })), null);
  // Oversized frames are dropped before JSON.parse is asked to do the work.
  assert.equal(parseClientControl(`{"t":"hello","name":"${'x'.repeat(600)}"}`), null);
});

test('names are capped, stripped of control characters, and never empty', () => {
  assert.equal(sanitiseName('a'.repeat(40)).length, 16);
  assert.equal(sanitiseName('ev\u0000il\u001b'), 'evil');
  assert.equal(sanitiseName('   '), 'Fighter');
  assert.equal(sanitiseName(''), 'Fighter');
});
