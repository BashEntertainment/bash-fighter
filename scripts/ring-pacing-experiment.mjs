// Ring-pacing attribution experiment (2026-09-09 task item 2): does
// delaying/lengthening the shrink clock (shrinkFullyClosedTick) alone
// raise combat share because fights get time to resolve, or does the
// match simply get longer with the same ending? Isolated change: only
// shrinkFullyClosedTick varies; everything else (population-aware safe
// extents, bot tuning) is untouched.
import { Sim } from '../packages/sim/src/sim.ts';
import { BotController, BotDifficulty, deriveBotSeed } from '../packages/sim/src/ai/bot.ts';
import { ALL_ARENAS } from '../packages/content/src/arenas.ts';
import * as fx from '../packages/sim/src/math/fixed.ts';

const N = 20;
const SEEDS = parseInt(process.argv[2] || '6', 10);
const CEIL = 48000; // 800s, generous
const BASE = 60 * 60 * 4; // default 4min
const VARIANTS = [
  ['baseline-4min', BASE],
  ['1.5x-6min', Math.round(BASE * 1.5)],
  ['2x-8min', BASE * 2],
];

function runMatch(arena, seed, shrinkFullyClosedTick) {
  const sim = new Sim(seed, N, undefined, arena, { shrinkFullyClosedTick });
  const bots = Array.from({ length: N }, (_, i) => new BotController(i, BotDifficulty.HARD, deriveBotSeed(seed, i)));
  const lastDamageTick = new Array(N).fill(-1);
  const lastPercent = new Array(N).fill(0);
  const wasEliminated = new Array(N).fill(false);
  let boundaryElims = 0, combatElims = 0, endTick = CEIL, matchEnded = false;
  for (let t = 0; t < CEIL; t++) {
    const inputs = bots.map((b) => b.nextInput(sim));
    sim.advance(inputs);
    for (let i = 0; i < N; i++) {
      const f = sim.getFighter(i);
      const pct = fx.toFloat(f.percent);
      if (pct > lastPercent[i] + 0.01) lastDamageTick[i] = t;
      lastPercent[i] = pct;
      if (f.eliminated && !wasEliminated[i]) {
        wasEliminated[i] = true;
        const recentlyHit = lastDamageTick[i] >= 0 && t - lastDamageTick[i] <= 60;
        if (recentlyHit) combatElims++; else boundaryElims++;
      }
    }
    if (sim.isMatchOver && sim.isMatchOver()) { endTick = t; matchEnded = true; break; }
  }
  let survivors = 0;
  for (let i = 0; i < N; i++) if (!sim.getFighter(i).eliminated) survivors++;
  return { durationSec: endTick/60, boundaryElims, combatElims, matchEnded, timeout: survivors >= 2 && !matchEnded };
}

for (const arenaEntry of ALL_ARENAS) {
  console.log(`\n=== ${arenaEntry.id} ===`);
  for (const [name, tick] of VARIANTS) {
    const rs = [];
    for (let s = 0; s < SEEDS; s++) rs.push(runMatch(arenaEntry.arena, 600000 + s*911 + arenaEntry.id.length, tick));
    const durs = rs.map(r=>r.durationSec).sort((a,b)=>a-b);
    const combat = rs.reduce((a,r)=>a+r.combatElims,0);
    const boundary = rs.reduce((a,r)=>a+r.boundaryElims,0);
    const timeouts = rs.filter(r=>r.timeout).length;
    console.log(`${name}: dur[min/med/max]=${durs[0].toFixed(0)}/${durs[Math.floor(durs.length/2)].toFixed(0)}/${durs[durs.length-1].toFixed(0)}s combat=${(100*combat/Math.max(1,combat+boundary)).toFixed(1)}% boundary=${(100*boundary/Math.max(1,combat+boundary)).toFixed(1)}% timeouts=${timeouts}/${SEEDS}`);
  }
}
