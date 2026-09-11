// Recorded canonical input stream fixture for Timed Brawl (2026-09-11),
// same construction technique as replay-input-stream.ts: a scripted "bot
// match" is run once to produce the InputFrame[][] the determinism test
// actually replays. Deterministic by construction (pure function of tick
// + sim state), and short so it is cheap to run in the test suite.
//
// This is deliberately the aggressive, un-defended attacker/defender split
// from the stocks fixture (attacker chases, defender shields early then
// stops) so at least one real KO -- and therefore at least one respawn,
// the behaviour unique to 'timedKO' -- happens well inside the short time
// limit below.
import {
  makeInputFrame,
  BUTTON_ATTACK,
  BUTTON_SHIELD,
  type InputFrame,
} from '../../src/types.ts';
import * as fx from '../../src/math/fixed.ts';
import { Sim, type FighterSnapshot } from '../../src/sim.ts';
import { PLACEHOLDER_CHARACTER } from '../../../content/src/characters/placeholder/data.ts';

export const REPLAY_TIMED_SEED = 20260911;
export const REPLAY_TIMED_CHARACTERS = [PLACEHOLDER_CHARACTER, PLACEHOLDER_CHARACTER] as const;
// Short time limit (5s) chosen so the fixture is fast to replay while
// still guaranteed (by the scripted, deterministic bot behaviour below) to
// contain at least one KO + respawn cycle before it ends.
export const REPLAY_TIMED_SETTINGS = {
  winCondition: 'timedKO' as const,
  timeLimitTicks: 300,
  respawnDelayTicks: 30,
  respawnInvulnTicks: 30,
};

const MELEE_RANGE: fx.Fixed = fx.fromFloat(22);
const FACING_NUDGE: fx.Fixed = fx.fromFloat(0.05);

function decideBotInput(self: FighterSnapshot, other: FighterSnapshot, tick: number, isDefender: boolean): InputFrame {
  if (self.state === 8 /* DEAD */) return makeInputFrame(0, 0, 0);
  const dx = fx.sub(other.posX, self.posX);
  const absDx = fx.abs(dx);
  if (isDefender) {
    const shieldWindow = tick % 200 < 30 && self.percent < fx.fromInt(20);
    if (shieldWindow && self.grounded) return makeInputFrame(BUTTON_SHIELD, 0, 0);
    return makeInputFrame(0, 0, 0);
  }
  const desiredFacing = dx >= 0 ? 1 : -1;
  if (self.facing !== desiredFacing) {
    return makeInputFrame(0, desiredFacing > 0 ? FACING_NUDGE : fx.neg(FACING_NUDGE), 0);
  }
  if (absDx > MELEE_RANGE) {
    return makeInputFrame(0, desiredFacing > 0 ? fx.ONE : fx.fromInt(-1), 0);
  }
  return makeInputFrame(BUTTON_ATTACK, desiredFacing > 0 ? fx.ONE : fx.fromInt(-1), 0);
}

export function buildReplayInputStreamTimed(): InputFrame[][] {
  const sim = new Sim(REPLAY_TIMED_SEED, 2, REPLAY_TIMED_CHARACTERS, undefined, REPLAY_TIMED_SETTINGS);
  const frames: InputFrame[][] = [];
  for (let t = 0; t < REPLAY_TIMED_SETTINGS.timeLimitTicks + 10; t++) {
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
