// Comprehensive re-measurement sweep (2026-09-09, John's pass): combat vs
// boundary elimination share, DPS, duration distribution, timeout rate at
// two different ceilings (harness-typical 360s vs generous 700s that
// allows the 1.25x stalemate override to fully resolve), whole-lobby-wipe
// / final-two-double-ko rates, novice (EASY) survival, per-character
// survival. Deterministic: fixed seeds, no wall-clock, no Math.random.
//
// Usage: node --experimental-strip-types scripts/full-sweep-metrics.mjs [seeds] [ceilingTicks]
import { Sim } from '../packages/sim/src/sim.ts';
import { BotController, BotDifficulty, deriveBotSeed } from '../packages/sim/src/ai/bot.ts';
import { makeInputFrame } from '../packages/sim/src/types.ts';
import { ALL_ARENAS } from '../packages/content/src/arenas.ts';
import { ALL_CHARACTERS } from '../packages/content/src/characters.ts';
import * as fx from '../packages/sim/src/math/fixed.ts';

const SEEDS = parseInt(process.argv[2] || '8', 10);
const CEIL = parseInt(process.argv[3] || '42000', 10); // 700s @ 60hz default
const N = 20;
const COMBAT_WINDOW_TICKS = 60;

const DIFFS = [
  ['EASY', BotDifficulty.EASY],
  ['MEDIUM', BotDifficulty.MEDIUM],
  ['HARD', BotDifficulty.HARD],
];

function runMatch(arenaEntry, seed, difficulty, chars) {
  const sim = new Sim(seed, N, chars, arenaEntry.arena);
  const bots = Array.from({ length: N }, (_, i) => new BotController(i, difficulty, deriveBotSeed(seed, i)));
  const lastDamageTick = new Array(N).fill(-1);
  const lastPercent = new Array(N).fill(0);
  const wasEliminated = new Array(N).fill(false);
  let boundaryElims = 0, combatElims = 0;
  let totalDamage = 0;
  let endTick = CEIL, matchEnded = false;

  for (let t = 0; t < CEIL; t++) {
    const inputs = bots.map((b) => b.nextInput(sim));
    sim.advance(inputs);
    for (let i = 0; i < N; i++) {
      const f = sim.getFighter(i);
      const pct = fx.toFloat(f.percent);
      if (pct > lastPercent[i] + 0.01) { lastDamageTick[i] = t; totalDamage += pct - lastPercent[i]; }
      lastPercent[i] = pct;
      if (f.eliminated && !wasEliminated[i]) {
        wasEliminated[i] = true;
        const recentlyHit = lastDamageTick[i] >= 0 && t - lastDamageTick[i] <= COMBAT_WINDOW_TICKS;
        if (recentlyHit) combatElims++; else boundaryElims++;
      }
    }
    if (sim.isMatchOver && sim.isMatchOver()) { endTick = t; matchEnded = true; break; }
  }

  let survivors = 0;
  const perCharSurvived = {};
  for (let i = 0; i < N; i++) {
    const f = sim.getFighter(i);
    if (!f.eliminated) survivors++;
  }

  let endingKind = 'resolved';
  if (survivors === 0) {
    const elimTicks = [];
    for (let i = 0; i < N; i++) {
      const et = sim.getFighter(i).eliminatedTick;
      if (et !== null && et !== undefined) elimTicks.push(et);
    }
    elimTicks.sort((a, b) => a - b);
    const lastTick = elimTicks[elimTicks.length - 1];
    const countInFinalBurst = elimTicks.filter((t) => lastTick - t <= 2).length;
    endingKind = countInFinalBurst <= 2 ? 'final-two-double-ko' : 'whole-lobby-wipe';
  } else if (survivors >= 2 && !matchEnded) {
    endingKind = 'timeout';
  }

  return {
    seed, matchEnded, durationSec: Number((endTick / 60).toFixed(1)), survivors,
    boundaryElims, combatElims, endingKind, totalDamage, endTick,
    survivedIdx: Array.from({ length: N }, (_, i) => !sim.getFighter(i).eliminated),
  };
}

console.log(`Full sweep: seeds=${SEEDS} ceiling=${CEIL}ticks (${(CEIL/60).toFixed(0)}s)\n`);

const summary = [];
for (const arenaEntry of ALL_ARENAS) {
  for (const [diffName, diffVal] of DIFFS) {
    const results = [];
    for (let s = 0; s < SEEDS; s++) {
      const seed = 200000 + s * 7919 + arenaEntry.id.length * 13 + diffName.length;
      // main table uses uniform DEFAULT_CHARACTER (undefined) to stay comparable
      // with prior measurements; per-character survival is measured separately below.
      results.push({ ...runMatch(arenaEntry, seed, diffVal, undefined), chars: Array.from({length:N},()=> 'default') });
    }
    const durations = results.map((r) => r.durationSec).sort((a, b) => a - b);
    const oneSurvivor = results.filter((r) => r.survivors === 1).length;
    const noSurvivor = results.filter((r) => r.survivors === 0).length;
    const timeouts = results.filter((r) => r.endingKind === 'timeout').length;
    const finalTwoDoubleKo = results.filter((r) => r.endingKind === 'final-two-double-ko').length;
    const wholeLobbyWipe = results.filter((r) => r.endingKind === 'whole-lobby-wipe').length;
    const totalBoundary = results.reduce((a, r) => a + r.boundaryElims, 0);
    const totalCombat = results.reduce((a, r) => a + r.combatElims, 0);
    const totalDamage = results.reduce((a, r) => a + r.totalDamage, 0);
    const totalTicks = results.reduce((a, r) => a + r.endTick, 0);
    const dps = totalDamage / (totalTicks / 60);
    // per-character survival
    const charSurv = {};
    const charTotal = {};
    for (const r of results) {
      r.chars.forEach((cid, i) => {
        charTotal[cid] = (charTotal[cid] || 0) + 1;
        if (r.survivedIdx[i]) charSurv[cid] = (charSurv[cid] || 0) + 1;
      });
    }
    const row = {
      arena: arenaEntry.id, difficulty: diffName, seeds: SEEDS,
      durMin: durations[0], durMed: durations[Math.floor(durations.length/2)], durMax: durations[durations.length-1],
      oneSurvivor, noSurvivor, timeouts, finalTwoDoubleKo, wholeLobbyWipe,
      boundaryPct: Number(((100*totalBoundary)/Math.max(1,totalBoundary+totalCombat)).toFixed(1)),
      combatPct: Number(((100*totalCombat)/Math.max(1,totalBoundary+totalCombat)).toFixed(1)),
      dps: Number(dps.toFixed(2)),
      charSurvivalPct: Object.fromEntries(Object.entries(charTotal).map(([k,v])=>[k, Number((100*(charSurv[k]||0)/v).toFixed(0))])),
    };
    summary.push(row);
    console.log(`${arenaEntry.id} / ${diffName}: dur[min/med/max]=${row.durMin}/${row.durMed}/${row.durMax}s 1surv=${oneSurvivor}/${SEEDS} nobody=${noSurvivor}/${SEEDS} timeout=${timeouts}/${SEEDS} dblKO=${finalTwoDoubleKo} wipe=${wholeLobbyWipe} boundary=${row.boundaryPct}% combat=${row.combatPct}% dps=${row.dps}`);
  }
}

// Novice survival on EASY (dedicated single seed run, human at idx 0 vs 19 EASY bots, but no bot pursuit on EASY)
console.log('\n=== Novice survival on EASY (passive human, 20-bot EASY match) ===');
for (const arenaEntry of ALL_ARENAS) {
  for (let s = 0; s < 5; s++) {
    const seed = 300000 + s * 131 + arenaEntry.id.length;
    const sim = new Sim(seed, N);
    const bots = Array.from({ length: N }, (_, i) => (i === 0 ? null : new BotController(i, BotDifficulty.EASY, deriveBotSeed(seed, i))));
    const idle = makeInputFrame(0, 0, 0);
    let elimTick = null;
    for (let t = 0; t < 21600; t++) {
      const inputs = bots.map((b) => (b ? b.nextInput(sim) : idle));
      sim.advance(inputs);
      if (sim.getFighter(0).eliminated) { elimTick = t; break; }
      if (sim.isMatchOver && sim.isMatchOver()) break;
    }
    console.log(`${arenaEntry.id} seed=${s}: novice survived ${elimTick === null ? '>360s (whole match)' : (elimTick/60).toFixed(1)+'s'}`);
  }
}

// Per-character survival: rotated roster, HARD difficulty, separate pass
// (uses a different character per fighter, so combat dynamics differ from
// the uniform-character table above -- not comparable to it, only used
// for relative character-vs-character survival).
console.log('\n=== Per-character survival (HARD, rotated roster, 20-fighter) ===');
const charSurvAgg = {};
const charTotalAgg = {};
for (const arenaEntry of ALL_ARENAS) {
  for (let s = 0; s < Math.max(3, Math.floor(SEEDS/2)); s++) {
    const seed = 400000 + s * 1013 + arenaEntry.id.length;
    const chars = Array.from({ length: N }, (_, i) => ALL_CHARACTERS[(i + s) % ALL_CHARACTERS.length].character);
    const ids = Array.from({ length: N }, (_, i) => ALL_CHARACTERS[(i + s) % ALL_CHARACTERS.length].id);
    const r = runMatch(arenaEntry, seed, BotDifficulty.HARD, chars);
    ids.forEach((cid, i) => {
      charTotalAgg[cid] = (charTotalAgg[cid] || 0) + 1;
      if (r.survivedIdx[i]) charSurvAgg[cid] = (charSurvAgg[cid] || 0) + 1;
    });
  }
}
for (const cid of Object.keys(charTotalAgg).sort()) {
  console.log(`${cid}: ${charSurvAgg[cid]||0}/${charTotalAgg[cid]} survived (${(100*(charSurvAgg[cid]||0)/charTotalAgg[cid]).toFixed(0)}%)`);
}

console.log('\nJSON_SUMMARY_START');
console.log(JSON.stringify(summary));
console.log('JSON_SUMMARY_END');
