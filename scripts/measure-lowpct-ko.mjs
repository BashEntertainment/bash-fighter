import { Sim } from '../packages/sim/src/sim.ts';
import { BotController, BotDifficulty, deriveBotSeed } from '../packages/sim/src/ai/bot.ts';
import { ALL_ARENAS } from '../packages/content/src/arenas.ts';
import * as fx from '../packages/sim/src/math/fixed.ts';

const N = 20;
const TICKS_CEILING = 21600;
const trials = parseInt(process.argv[2] || '6', 10);

for (const entry of ALL_ARENAS) {
  const allEvents = [];
  for (let t = 0; t < trials; t++) {
    const seed = 3000 + t;
    const sim = new Sim(seed, N, undefined, entry.arena);
    const bots = Array.from({ length: N }, (_, i) => new BotController(i, BotDifficulty.EASY, deriveBotSeed(seed, i)));
    let ticks = 0;
    let lastLen = 0;
    while (!sim.isMatchOver() && ticks < TICKS_CEILING) {
      const inputs = bots.map((b) => b.nextInput(sim));
      sim.advance(inputs);
      ticks++;
      const ev = sim.eliminationEvents;
      for (let i = lastLen; i < ev.length; i++) allEvents.push(ev[i]);
      lastLen = ev.length;
    }
  }
  const kos = allEvents.filter((e) => e.cause === 'knockout');
  const pct = (e) => (e.percentAtDeath) / 65536 * 100;
  const under40 = kos.filter((e) => pct(e) < 40);
  const under25 = kos.filter((e) => pct(e) < 25);
  console.log(entry.id || entry.arena.name, {
    totalElim: allEvents.length,
    kos: kos.length,
    koShare: (kos.length / Math.max(1, allEvents.length) * 100).toFixed(1) + '%',
    under40pct: under40.length,
    under25pct: under25.length,
    minPct: kos.length ? Math.min(...kos.map(pct)).toFixed(1) : null,
    medianPct: kos.length ? pct(kos.slice().sort((a,b)=>a.percentAtDeath-b.percentAtDeath)[Math.floor(kos.length/2)]).toFixed(1) : null,
  });
}
