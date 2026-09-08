// Recorded canonical 20-fighter input stream fixture (this task's item:
// "20-fighter golden fixture"). Deliberately simpler than the 2-fighter
// fixture (replay-input-stream.ts) — a pure function of (tick, fighter
// index), no opponent-aware bot logic needed — since the point here is
// exercising the N-fighter broad-phase/elimination/arena-shrink path at
// scale, not a scripted narrative match. Every fighter walks back and
// forth and throws attacks/shields on a staggered per-index schedule, so
// fighters overlap, hit each other, and get caught by the collapsing
// arena — all deterministically, since it's a pure function of tick and
// index, not of any sim state.
import { makeInputFrame, BUTTON_ATTACK, BUTTON_SHIELD, type InputFrame } from '../../src/types.ts';
import * as fx from '../../src/math/fixed.ts';
import { PLACEHOLDER_CHARACTER } from '../../../content/src/characters/placeholder/data.ts';
import { BATTLE_ROYALE_20_ARENA } from '../../../content/src/index.ts';

export const REPLAY_20_N = 20;
export const REPLAY_20_SEED = 20260920;
export const REPLAY_20_CHARACTERS = Array.from({ length: REPLAY_20_N }, () => PLACEHOLDER_CHARACTER);
export const REPLAY_20_ARENA = BATTLE_ROYALE_20_ARENA;
// battleRoyale (the default) forces single-stock + arena shrink, exactly
// what this fixture is meant to exercise.
export const REPLAY_20_SETTINGS = { winCondition: 'battleRoyale' as const };
// Kept modest per the OOM lesson (see wiki "Test Suite Hang Incident
// 2026-09-07" / "Agent Operating Rules"): a few hundred ticks is enough to
// pin determinism without a 17,000-tick fixture at N=20.
export const REPLAY_20_TICKS = 600;

const STICK_ONE: fx.Fixed = fx.ONE;

function inputForTick(tick: number, index: number): InputFrame {
  // Staggered per-fighter phase so fighters do not all move in lockstep
  // (which would degenerate into a much less interesting, less
  // broad-phase-exercising motion pattern).
  const phase = (tick + index * 7) % 90;
  const attack = (tick + index * 3) % 41 === 0;
  const shield = !attack && phase >= 60 && phase < 70;
  const buttons = (attack ? BUTTON_ATTACK : 0) | (shield ? BUTTON_SHIELD : 0);
  const stickX = phase < 45 ? STICK_ONE : fx.neg(STICK_ONE);
  return makeInputFrame(buttons, stickX, 0);
}

export function buildReplayInputStream20(): InputFrame[][] {
  const frames: InputFrame[][] = [];
  for (let t = 0; t < REPLAY_20_TICKS; t++) {
    const frame: InputFrame[] = [];
    for (let i = 0; i < REPLAY_20_N; i++) frame.push(inputForTick(t, i));
    frames.push(frame);
  }
  return frames;
}
