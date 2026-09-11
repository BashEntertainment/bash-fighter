// Human-readable audit report generalizing the spawn-clearance check to
// every stage/spawn (see wiki "Spawn Clearance Audit: All Stages
// 2026-09-11"). The actual pass/fail logic lives in
// packages/content/src/spawn-clearance/compute.ts and is exercised as a
// permanent gate by packages/content/test/spawn-clearance.test.ts; this
// script is the printable table, kept in sync by importing that same
// module rather than reimplementing the maths.
import { ALL_ARENAS } from '../packages/content/src/arenas.ts';
import { computeWorstCaseArc, computeStageClearance, HORIZ_SAFETY_FACTOR, VERT_SAFETY_FACTOR } from '../packages/content/src/spawn-clearance/compute.ts';

const worst = computeWorstCaseArc();
console.log('=== Worst-case early-hit arc (lightest roster fighter, tick=0) ===');
console.log(`Worst horizontal arc: ${worst.horiz.toFixed(1)} units`);
console.log(`Worst upward (ceiling) arc: ${worst.upHeight.toFixed(1)} units`);
console.log(`Safety factors: horizontal >= ${HORIZ_SAFETY_FACTOR}x, vertical >= ${VERT_SAFETY_FACTOR}x\n`);

let anyShortfall = false;
for (const { id, arena } of ALL_ARENAS) {
  const results = computeStageClearance(arena, worst);
  console.log(`--- ${id} (${arena.name}) ---`);
  for (const r of results) {
    if (r.shortfall) anyShortfall = true;
    const flag = r.shortfall ? '  <<< SHORTFALL' : '';
    console.log(`  slot ${String(r.slot).padStart(2)}: x=${r.x.toFixed(0).padStart(5)} y=${r.y.toFixed(0).padStart(4)}  horizClear=${r.horizClear.toFixed(1).padStart(7)} (${r.horizFactor.toFixed(2)}x)  vertClear=${r.vertClear.toFixed(1).padStart(6)} (${r.vertFactor.toFixed(2)}x)${flag}`);
  }
}
console.log(anyShortfall ? '\nSHORTFALLS FOUND.' : '\nAll spawns clear the required safety factor on every stage.');
process.exitCode = anyShortfall ? 1 : 0;
