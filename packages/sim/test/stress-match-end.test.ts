// Stress test for task #28023 TASK A: does every battleRoyale match, run to
// completion by bots, terminate cleanly within a bounded number of ticks —
// even under an artificially fast arena shrink where many fighters can be
// forced together (and potentially KO'd) in the same tick? A match "ends
// cleanly" here means Sim.isMatchOver() becomes true (server relies on this,
// not on getWinner() being non-null -- see server/src/match.ts) within a
// generous tick ceiling, and getLeaderboard() returns exactly numFighters
// distinct placements with no duplicates/gaps (which would indicate the
// simultaneous-elimination placement bookkeeping double-counted or skipped
// a fighter).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Sim } from '../src/sim.ts';
import { BotController, BotDifficulty, deriveBotSeed } from '../src/ai/bot.ts';

const NUM_FIGHTERS = 20;
// Fast shrink: fully closed after 20s instead of the default 4 minutes, so
// many fighters are routinely forced into the same tiny ring at once --
// the scenario the task brief calls out as suspect for simultaneous KOs.
const FAST_SHRINK_SETTINGS = {
  winCondition: 'battleRoyale' as const,
  arenaShrink: true,
  shrinkFullyClosedTick: 60 * 20,
};
// 3x a generous normal-speed match length (10 min at 60fps) as the ceiling
// past which a match is considered hung rather than just slow.
const TICK_CEILING = 60 * 60 * 10 * 3;

function runOneMatch(seed: number): { ticks: number; over: boolean; leaderboard: number[]; winner: number | null } {
  const sim = new Sim(seed, NUM_FIGHTERS, undefined, undefined, FAST_SHRINK_SETTINGS);
  const bots = Array.from(
    { length: NUM_FIGHTERS },
    (_, i) => new BotController(i, BotDifficulty.MEDIUM, deriveBotSeed(seed, i)),
  );
  let ticks = 0;
  while (!sim.isMatchOver() && ticks < TICK_CEILING) {
    const inputs = bots.map((b) => b.nextInput(sim));
    sim.advance(inputs);
    ticks++;
  }
  return { ticks, over: sim.isMatchOver(), leaderboard: sim.getLeaderboard(), winner: sim.getWinner() };
}

describe('Stress: fast-shrink battleRoyale matches always resolve cleanly', () => {
  it('100 bot matches with a 20s full-shrink schedule all terminate within the tick ceiling with a valid leaderboard', () => {
    const NUM_MATCHES = 100;
    const hung: number[] = [];
    const badLeaderboard: number[] = [];
    let ties = 0;
    let maxTicks = 0;

    for (let m = 0; m < NUM_MATCHES; m++) {
      const seed = 900000 + m;
      const result = runOneMatch(seed);
      maxTicks = Math.max(maxTicks, result.ticks);
      if (!result.over) hung.push(m);
      if (result.winner === null) ties++; // simultaneous elimination: a draw, not a hang.

      const lb = result.leaderboard;
      const distinct = new Set(lb);
      const validRange = lb.every((idx) => idx >= 0 && idx < NUM_FIGHTERS);
      if (lb.length !== NUM_FIGHTERS || distinct.size !== NUM_FIGHTERS || !validRange) {
        badLeaderboard.push(m);
      }
    }

    assert.equal(
      hung.length,
      0,
      `${hung.length}/${NUM_MATCHES} matches never reached isMatchOver() within ${TICK_CEILING} ticks (match indices: ${hung.join(', ')})`,
    );
    assert.equal(
      badLeaderboard.length,
      0,
      `${badLeaderboard.length}/${NUM_MATCHES} matches produced an invalid leaderboard (duplicate/missing placement) -- match indices: ${badLeaderboard.join(', ')}`,
    );
    // Not an assertion, just visible evidence in the test log for the report.
    console.log(
      `[stress] ${NUM_MATCHES} matches, 0 hung, ${ties} simultaneous-elimination draws, max ticks used ${maxTicks} of ceiling ${TICK_CEILING}`,
    );
  });
});
