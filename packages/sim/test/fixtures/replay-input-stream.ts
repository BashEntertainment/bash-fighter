// Recorded canonical input stream fixture for the determinism harness
// (Engine Architecture §2). A deterministic, hand-scripted "match": player
// 0 walks right and jumps, player 1 walks left and jumps back, repeated
// with variation, for 180 ticks (3 seconds at 60Hz). Not meant to be a real
// match, just a fixed, reproducible input sequence to hash against.
import { BUTTON_JUMP, makeInputFrame, type InputFrame } from '../../src/types.ts';
import { ONE, fromInt } from '../../src/math/fixed.ts';

export const REPLAY_SEED = 20260907;
export const REPLAY_LENGTH = 180;

export function buildReplayInputStream(): InputFrame[][] {
  const frames: InputFrame[][] = [];
  for (let t = 0; t < REPLAY_LENGTH; t++) {
    const phase = t % 60;
    const p0Jump = phase === 0 ? BUTTON_JUMP : 0;
    const p1Jump = phase === 30 ? BUTTON_JUMP : 0;
    const p0StickX = phase < 30 ? ONE : fromInt(-1);
    const p1StickX = phase < 30 ? fromInt(-1) : ONE;
    frames.push([
      makeInputFrame(p0Jump, p0StickX, 0),
      makeInputFrame(p1Jump, p1StickX, 0),
    ]);
  }
  return frames;
}
