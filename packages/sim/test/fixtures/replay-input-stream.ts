// Recorded canonical input stream fixture for the determinism harness
// (Engine Architecture section 2). This is a scripted deterministic "bot
// match": fighter 0 chases and pressures fighter 1 with forward tilts,
// fighter 1 shields early on and otherwise stands its ground. Every
// decision is a pure function of the current tick and the two fighters'
// (deterministic) sim state, so replaying this exact sequence of
// InputFrames on a fresh Sim always reproduces the same match. The bot
// logic below is only ever used to *record* the fixture: the recorded
// InputFrame[][] it produces is what the determinism tests actually
// replay.
//
// This walks through attacks, a connecting hit, percent accumulation,
// shielding (with shield stun and shield-health loss), a stock loss +
// respawn, and a full match end (three stocks lost) — see "Sim Core
// Implementation Notes" on the wiki for the constants this exercises.
import {
  makeInputFrame,
  BUTTON_ATTACK,
  BUTTON_SHIELD,
  type InputFrame,
} from '../../src/types.ts';
import * as fx from '../../src/math/fixed.ts';
import { Sim, type FighterSnapshot } from '../../src/sim.ts';
import { PLACEHOLDER_CHARACTER } from '../../../content/src/characters/placeholder/data.ts';

export const REPLAY_SEED = 20260907;
export const REPLAY_CHARACTERS = [PLACEHOLDER_CHARACTER, PLACEHOLDER_CHARACTER] as const;
// Safety cap so a bad edit that stops the match from ever ending can't spin
// forever; the real match recorded below ends well before this.
const MAX_TICKS = 30000;

const MELEE_RANGE: fx.Fixed = fx.fromFloat(22);
const FACING_NUDGE: fx.Fixed = fx.fromFloat(0.05);

function decideBotInput(
  self: FighterSnapshot,
  other: FighterSnapshot,
  tick: number,
  isDefender: boolean,
): InputFrame {
  if (self.state === 8 /* DEAD */) return makeInputFrame(0, 0, 0);

  const dx = fx.sub(other.posX, self.posX);
  const absDx = fx.abs(dx);

  if (isDefender) {
    // Shield during the opening exchanges while damage is still low, then
    // stop bothering (so later hits connect and eventually rack up enough
    // percent to be knocked out).
    const shieldWindow = tick % 400 < 60 && self.percent < fx.fromInt(30);
    if (shieldWindow && self.grounded) return makeInputFrame(BUTTON_SHIELD, 0, 0);
    return makeInputFrame(0, 0, 0);
  }

  const desiredFacing = dx >= 0 ? 1 : -1;
  if (self.facing !== desiredFacing) {
    // Small nudge to turn around without overshooting past the opponent
    // (a full-speed step would just cross over and flip-flop forever).
    return makeInputFrame(0, desiredFacing > 0 ? FACING_NUDGE : fx.neg(FACING_NUDGE), 0);
  }
  if (absDx > MELEE_RANGE) {
    return makeInputFrame(0, desiredFacing > 0 ? fx.ONE : fx.fromInt(-1), 0);
  }
  // In range: forward tilt, aimed at the opponent's side.
  return makeInputFrame(BUTTON_ATTACK, desiredFacing > 0 ? fx.ONE : fx.fromInt(-1), 0);
}

/** Build the fixture by actually running a scripted bot match to
 * completion. Deterministic: same seed, same characters, same bot logic
 * always produces the same recorded InputFrame[][]. */
export const REPLAY_SETTINGS = { winCondition: 'stocks' as const, startingStocks: 3 };

export function buildReplayInputStream(): InputFrame[][] {
  const sim = new Sim(REPLAY_SEED, 2, REPLAY_CHARACTERS, undefined, {
    winCondition: 'stocks',
    startingStocks: 3,
  });
  const frames: InputFrame[][] = [];
  for (let t = 0; t < MAX_TICKS; t++) {
    const f0 = sim.getFighter(0);
    const f1 = sim.getFighter(1);
    const input0 = decideBotInput(f0, f1, t, false);
    const input1 = decideBotInput(f1, f0, t, true);
    const frame: InputFrame[] = [input0, input1];
    frames.push(frame);
    sim.advance(frame);
    if (sim.isMatchOver()) break;
  }
  return frames;
}
