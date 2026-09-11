// Standalone repro for the 2026-09-10 "20/20 alive at ceiling" defect:
// the-foundry, seed 1003, HARD bots. Prints tick / alive / live safe
// extents / each fighter's position+percent / stalemate-override state
// every 500 ticks. Run with: npx tsx scripts/repro/repro-foundry-1003.ts
import { Sim } from '../../packages/sim/src/sim.ts';
import { BotController, BotDifficulty, deriveBotSeed } from '../../packages/sim/src/ai/bot.ts';
import { computeSafeExtents, computeCurrentBlastRect } from '../../packages/sim/src/arena-shrink.ts';
import { resolveMatchSettings } from '../../packages/sim/src/match-settings.ts';
import { ALL_ARENAS } from '../../packages/content/src/arenas.ts';

const N = 20;
const seed = Number(process.argv[2] ?? 1003);
const entry = ALL_ARENAS[seed % ALL_ARENAS.length]!;
console.log('seed', seed, '-> arena', entry.id);
const arena = entry.arena;
const settings = resolveMatchSettings({});
const sim = new Sim(seed, N, undefined, arena);
const bots = Array.from({ length: N }, (_, i) => new BotController(i, BotDifficulty.HARD, deriveBotSeed(seed, i)));

const TICK_CEILING = 60 * 60 * 10;
let ticks = 0;
while (!sim.isMatchOver() && ticks < TICK_CEILING) {
  const inputs = bots.map((b) => b.nextInput(sim));
  sim.advance(inputs);
  ticks++;
  if (ticks % 500 === 0 || ticks === TICK_CEILING) {
    let alive = 0;
    for (let i = 0; i < N; i++) if (!sim.getFighter(i).eliminated) alive++;
    const safe = computeSafeExtents(arena, alive, N, ticks, settings);
    const rect = computeCurrentBlastRect(arena, ticks, alive, N, settings);
    const staleTick = settings.shrinkFullyClosedTick;
    const overrideEngaged = ticks > staleTick;
    console.log(
      `tick=${ticks} alive=${alive} safe=[${safe.minX / 65536},${safe.maxX / 65536}] ` +
        `rect=[${rect.minX / 65536},${rect.maxX / 65536}] staleOverrideEngaged=${overrideEngaged}`,
    );
    if (ticks % 4000 === 0) {
      for (let i = 0; i < N; i++) {
        const f = sim.getFighter(i);
        if (!f.eliminated) console.log(`  fighter${i} x=${f.x / 65536} y=${f.y / 65536} pct=${f.percent / 65536}`);
      }
    }
  }
}
let survivors = 0;
for (let i = 0; i < N; i++) if (!sim.getFighter(i).eliminated) survivors++;
console.log('done ticks=', ticks, 'over=', sim.isMatchOver(), 'survivors=', survivors);
