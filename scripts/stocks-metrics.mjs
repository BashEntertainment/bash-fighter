import { Sim } from '../packages/sim/src/sim.ts';
import { BotController, BotDifficulty, deriveBotSeed } from '../packages/sim/src/ai/bot.ts';

const N = 20;
const TICKS_CEILING = 60 * 60 * 6;
const TRIALS = 4;
const SHRINK_CLOSED = 60 * 60 * 3; // 3 min hard-margin full closure for this experiment

function runOne(stocks, seed) {
  const sim = new Sim(seed, N, undefined, undefined, {
    winCondition: 'stocks', startingStocks: stocks, arenaShrink: true, shrinkFullyClosedTick: SHRINK_CLOSED,
  });
  const bots = Array.from({ length: N }, (_, i) => new BotController(i, BotDifficulty.HARD, deriveBotSeed(seed, i)));
  let t = 0;
  for (; t < TICKS_CEILING; t++) {
    const inputs = bots.map((b) => b.nextInput(sim));
    sim.advance(inputs);
    if (sim.isMatchOver()) break;
  }
  return { ticks: t, resolved: sim.isMatchOver(), seconds: t / 60 };
}

for (const stocks of [2, 3]) {
  const results = [];
  for (let i = 0; i < TRIALS; i++) results.push(runOne(stocks, 2000 + i));
  const secs = results.map((r) => r.seconds).sort((a, b) => a - b);
  const median = secs[Math.floor(secs.length / 2)];
  const unresolved = results.filter((r) => !r.resolved).length;
  console.log(`stocks=${stocks}: seconds=[${secs.map((s) => s.toFixed(1)).join(', ')}] median=${median.toFixed(1)}s unresolved=${unresolved}/${TRIALS}`);
}
