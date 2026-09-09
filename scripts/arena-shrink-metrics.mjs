// Headless 20-fighter metrics harness for the arena-shrink rework (see
// wiki "Arena Collapse Cascade: Why Matches End With Nobody Left
// 2026-09-09" and "Arena Shrink Rework: Fighting Decides Matches
// 2026-09-09"). Deterministic: fixed seeds, no wall-clock, no
// Math.random. Run via:
//   node --experimental-strip-types scripts/arena-shrink-metrics.mjs [arenaId] [seeds] [ticks]
//
// Measures, per match: duration, survivor count (0/1/2+), and — the key
// number — how many eliminations were boundary-caused (fighter had not
// taken damage recently, i.e. the closing rectangle reached them rather
// than a hit knocking them out) versus combat-caused (damage within the
// last COMBAT_WINDOW_TICKS of elimination). Also runs one "passive"
// match where fighter 0 never presses a button, to check it cannot win
// by standing still.
import { Sim } from '../packages/sim/src/sim.ts';
import { BotController, BotDifficulty, deriveBotSeed } from '../packages/sim/src/ai/bot.ts';
import { makeInputFrame } from '../packages/sim/src/types.ts';
import { ALL_ARENAS } from '../packages/content/src/arenas.ts';
import * as fx from '../packages/sim/src/math/fixed.ts';

const arenaArg = process.argv[2] || 'all';
const SEEDS = parseInt(process.argv[3] || '8', 10);
const TICKS = parseInt(process.argv[4] || '21600', 10); // 6 min hard cap @ 60hz
const N = 20;
const COMBAT_WINDOW_TICKS = 60; // 1s: "recently hit" window for cause attribution

const arenaEntries = arenaArg === 'all' ? ALL_ARENAS : ALL_ARENAS.filter((a) => a.id === arenaArg);
if (arenaEntries.length === 0) {
  console.error(`unknown arena id: ${arenaArg}`);
  process.exit(1);
}

function runMatch(arenaEntry, seed, { passiveIndex = -1 } = {}) {
  const sim = new Sim(seed, N, undefined, arenaEntry.arena);
  const bots = Array.from({ length: N }, (_, i) =>
    i === passiveIndex ? null : new BotController(i, BotDifficulty.HARD, deriveBotSeed(seed, i)),
  );
  const lastDamageTick = new Array(N).fill(-1);
  const lastPercent = new Array(N).fill(0);
  const wasEliminated = new Array(N).fill(false);
  let boundaryElims = 0;
  let combatElims = 0;
  let endTick = TICKS;
  let matchEnded = false;

  const idleInput = makeInputFrame(0, 0, 0);

  for (let t = 0; t < TICKS; t++) {
    const inputs = bots.map((b, i) => (b ? b.nextInput(sim) : idleInput));
    sim.advance(inputs);

    for (let i = 0; i < N; i++) {
      const f = sim.getFighter(i);
      const pct = fx.toFloat(f.percent);
      if (pct > lastPercent[i] + 0.01) lastDamageTick[i] = t;
      lastPercent[i] = pct;
      if (f.eliminated && !wasEliminated[i]) {
        wasEliminated[i] = true;
        const recentlyHit = lastDamageTick[i] >= 0 && t - lastDamageTick[i] <= COMBAT_WINDOW_TICKS;
        if (recentlyHit) combatElims++;
        else boundaryElims++;
      }
    }

    if (sim.isMatchOver && sim.isMatchOver()) {
      endTick = t;
      matchEnded = true;
      break;
    }
  }

  let survivors = 0;
  for (let i = 0; i < N; i++) if (!sim.getFighter(i).eliminated) survivors++;

  // Distinguish, among nobody-survived endings, a final-two double-KO
  // (the last two fighters standing eliminate each other on the same or
  // an adjacent frame) from a whole-lobby wipe (three or more fighters
  // eliminated together, i.e. the boundary cascade). See wiki "Ring
  // Pressure Not Executioner: 2026-09-09 Rebalance" -- this was flying
  // blind before 2026-09-09.
  let endingKind = 'resolved'; // resolved | timeout | final-two-double-ko | whole-lobby-wipe
  if (survivors === 0) {
    const elimTicks = [];
    for (let i = 0; i < N; i++) {
      const et = sim.getFighter(i).eliminatedTick;
      if (et !== null && et !== undefined) elimTicks.push(et);
    }
    elimTicks.sort((a, b) => a - b);
    const lastTick = elimTicks[elimTicks.length - 1];
    const ADJACENT = 2; // ticks; "same or adjacent frame"
    const countInFinalBurst = elimTicks.filter((t) => lastTick - t <= ADJACENT).length;
    endingKind = countInFinalBurst <= 2 ? 'final-two-double-ko' : 'whole-lobby-wipe';
  } else if (survivors >= 2 && !matchEnded) {
    endingKind = 'timeout';
  }

  const passiveResult =
    passiveIndex >= 0
      ? {
          passiveEliminatedTick: sim.getFighter(passiveIndex).eliminatedTick,
          passiveSurvived: !sim.getFighter(passiveIndex).eliminated,
          passivePlacement: sim.getFighter(passiveIndex).placement,
        }
      : null;

  return {
    seed,
    matchEnded,
    durationSec: Number((endTick / 60).toFixed(1)),
    survivors,
    boundaryElims,
    combatElims,
    endingKind,
    passiveResult,
  };
}

for (const arenaEntry of arenaEntries) {
  const results = [];
  for (let s = 0; s < SEEDS; s++) {
    const seed = 100000 + s * 7919 + arenaEntry.id.length;
    results.push(runMatch(arenaEntry, seed));
  }
  // One passive-player match per arena: fighter 0 never presses a button.
  const passive = runMatch(arenaEntry, 999001, { passiveIndex: 0 });

  const durations = results.map((r) => r.durationSec).sort((a, b) => a - b);
  const noSurvivor = results.filter((r) => r.survivors === 0).length;
  const oneSurvivor = results.filter((r) => r.survivors === 1).length;
  const multiSurvivor = results.filter((r) => r.survivors >= 2).length;
  const totalBoundary = results.reduce((a, r) => a + r.boundaryElims, 0);
  const totalCombat = results.reduce((a, r) => a + r.combatElims, 0);

  console.log(`\n=== ${arenaEntry.id} (${SEEDS} seeds) ===`);
  console.log(`duration (s): min=${durations[0]} median=${durations[Math.floor(durations.length / 2)]} max=${durations[durations.length - 1]}`);
  console.log(`endings: 1-survivor=${oneSurvivor}/${SEEDS}  nobody-survived=${noSurvivor}/${SEEDS}  multi-survivor(timeout)=${multiSurvivor}/${SEEDS}`);
  const finalTwoDoubleKo = results.filter((r) => r.endingKind === 'final-two-double-ko').length;
  const wholeLobbyWipe = results.filter((r) => r.endingKind === 'whole-lobby-wipe').length;
  console.log(`nobody-survived breakdown: final-two-double-ko=${finalTwoDoubleKo}/${SEEDS}  whole-lobby-wipe=${wholeLobbyWipe}/${SEEDS}`);
  console.log(`eliminations: boundary=${totalBoundary}  combat=${totalCombat}  boundary%=${((100 * totalBoundary) / Math.max(1, totalBoundary + totalCombat)).toFixed(1)}%`);
  console.log(`passive player (fighter 0, never presses a button): survived=${passive.passiveResult.passiveSurvived} eliminatedTick=${passive.passiveResult.passiveEliminatedTick} placement=${passive.passiveResult.passivePlacement} matchDurationSec=${passive.durationSec}`);
  console.log(JSON.stringify(results, null, 1));
}
