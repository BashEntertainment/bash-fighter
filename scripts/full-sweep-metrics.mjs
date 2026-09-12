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
import { DEFAULT_MATCH_SETTINGS } from '../packages/sim/src/match-settings.ts';
import { assignServerCharacters } from './lib/bot-character-assignment.mjs';

// Anti-drift guard (task #28195): this harness constructs `new Sim(...)`
// with no settings override, so it always inherits DEFAULT_MATCH_SETTINGS
// -- the same object server/src/match.ts uses in production unless the
// MATCH_SHRINK_FULLY_CLOSED_TICK test-only env var is set (never set by
// the production systemd unit; see match.ts start()). Print the settings
// this run actually used so a future silent change to either side is
// visible in the log rather than misread as a game-behavior change, and
// warn loudly if this file's own ceiling default no longer gives the
// stalemate override (relax window, ~2min past shrinkFullyClosedTick) room
// to resolve before CEIL -- that mismatch previously produced false
// "high timeout rate" readings (see wiki: Bot Clustering, Vertical Bots,
// Ring Pacing 2026-09-09, section 1).
console.log('=== Harness settings vs production DEFAULT_MATCH_SETTINGS ===');
console.log(JSON.stringify(DEFAULT_MATCH_SETTINGS));
if (process.env.MATCH_SHRINK_FULLY_CLOSED_TICK) {
  console.log(`WARNING: MATCH_SHRINK_FULLY_CLOSED_TICK=${process.env.MATCH_SHRINK_FULLY_CLOSED_TICK} is set in this shell -- this run's Sim.shrinkFullyClosedTick will NOT match production. Unset it to measure production-equivalent behavior.`);
}

const SEEDS = parseInt(process.argv[2] || '8', 10);
const CEIL = parseInt(process.argv[3] || '42000', 10); // 700s @ 60hz default
const MIN_SAFE_CEIL = DEFAULT_MATCH_SETTINGS.shrinkFullyClosedTick + 120 * 60; // shrink clock + 2min relax window + margin
if (CEIL < MIN_SAFE_CEIL) {
  console.log(`WARNING: ceilingTicks=${CEIL} is below ${MIN_SAFE_CEIL} (current shrinkFullyClosedTick + stalemate-override relax window). Timeout/no-survivor counts below may be a harness-ceiling artifact, not a real game defect -- raise the ceiling before trusting them.`);
}
const N = 20;

const DIFFS = [
  ['EASY', BotDifficulty.EASY],
  ['MEDIUM', BotDifficulty.MEDIUM],
  ['HARD', BotDifficulty.HARD],
];

function runMatch(arenaEntry, seed, difficulty, chars) {
  const sim = new Sim(seed, N, chars, arenaEntry.arena);
  const bots = Array.from({ length: N }, (_, i) => new BotController(i, difficulty, deriveBotSeed(seed, i)));
  const lastPercent = new Array(N).fill(0);
  // Truthful attribution (2026-09-10): read Sim.eliminationEvents directly instead of guessing
  // "recent damage means combat" from the outside. See sim.ts EliminationCause and wiki
  // 'Opening-Seconds Eliminations: Falls Misreported as Knockouts 2026-09-10'.
  let boundaryElims = 0, combatElims = 0, fallElims = 0, ringLethalElims = 0;
  let earlyFallElims = 0; // falls in the first 10s of the match, at low percent -- the specific defect under investigation
  let totalDamage = 0;
  let endTick = CEIL, matchEnded = false;

  for (let t = 0; t < CEIL; t++) {
    const inputs = bots.map((b) => b.nextInput(sim));
    sim.advance(inputs);
    for (let i = 0; i < N; i++) {
      const f = sim.getFighter(i);
      const pct = fx.toFloat(f.percent);
      if (pct > lastPercent[i] + 0.01) totalDamage += pct - lastPercent[i];
      lastPercent[i] = pct;
    }
    for (const ev of sim.eliminationEvents) {
      if (ev.cause === 'knockout') combatElims++;
      else if (ev.cause === 'fall') { fallElims++; boundaryElims++; }
      else if (ev.cause === 'ring_lethal') { ringLethalElims++; boundaryElims++; }
      else boundaryElims++; // 'ring'
      if (ev.cause === 'fall' && t < 600 /* 10s @ 60Hz */ && fx.toFloat(ev.percentAtDeath) < 10) {
        earlyFallElims++;
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
    boundaryElims, combatElims, fallElims, ringLethalElims, earlyFallElims, endingKind, totalDamage, endTick,
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
      // Diagnosed 2026-09-11 (docs/MEASUREMENT.md): the previous
      // uniform-DEFAULT_CHARACTER (undefined) choice here was NOT neutral --
      // DEFAULT_CHARACTER has moves: [], so every one of these 20 bots was
      // physically unable to land an attack, at any difficulty, regardless
      // of AI tuning. This is the real cause of the ~0% combat / ~97-100%
      // ring split this table used to report. Use the same seeded
      // ALL_CHARACTERS roster draw server/src/rooms.ts's bot-fill gives
      // production bots, all-bot (no protected human seat here).
      const chars = assignServerCharacters(seed, N);
      results.push({ ...runMatch(arenaEntry, seed, diffVal, chars), chars: chars.map((c) => c.name) });
    }
    const durations = results.map((r) => r.durationSec).sort((a, b) => a - b);
    const oneSurvivor = results.filter((r) => r.survivors === 1).length;
    const noSurvivor = results.filter((r) => r.survivors === 0).length;
    const timeouts = results.filter((r) => r.endingKind === 'timeout').length;
    const finalTwoDoubleKo = results.filter((r) => r.endingKind === 'final-two-double-ko').length;
    const wholeLobbyWipe = results.filter((r) => r.endingKind === 'whole-lobby-wipe').length;
    const totalBoundary = results.reduce((a, r) => a + r.boundaryElims, 0);
    const totalCombat = results.reduce((a, r) => a + r.combatElims, 0);
    const totalFall = results.reduce((a, r) => a + r.fallElims, 0);
    const totalRingLethal = results.reduce((a, r) => a + r.ringLethalElims, 0);
    const totalEarlyFall = results.reduce((a, r) => a + r.earlyFallElims, 0);
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
      fallPct: Number(((100*totalFall)/Math.max(1,totalBoundary+totalCombat)).toFixed(1)),
      ringLethalPct: Number(((100*totalRingLethal)/Math.max(1,totalBoundary+totalCombat)).toFixed(1)),
      earlyFallElims: totalEarlyFall,
      dps: Number(dps.toFixed(2)),
      charSurvivalPct: Object.fromEntries(Object.entries(charTotal).map(([k,v])=>[k, Number((100*(charSurv[k]||0)/v).toFixed(0))])),
    };
    summary.push(row);
    console.log(`${arenaEntry.id} / ${diffName}: dur[min/med/max]=${row.durMin}/${row.durMed}/${row.durMax}s 1surv=${oneSurvivor}/${SEEDS} nobody=${noSurvivor}/${SEEDS} timeout=${timeouts}/${SEEDS} dblKO=${finalTwoDoubleKo} wipe=${wholeLobbyWipe} boundary=${row.boundaryPct}% combat=${row.combatPct}% fall=${row.fallPct}% ringLethal=${row.ringLethalPct}% earlyFalls(<10s,<10%)=${row.earlyFallElims}/${SEEDS} dps=${row.dps}`);
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
