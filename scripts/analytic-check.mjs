import { computeKnockbackMagnitude, earlyMatchKnockbackScale } from '../packages/sim/src/knockback.ts';
import * as fx from '../packages/sim/src/math/fixed.ts';
import { computeGroundHalfExtents, computeSafeExtents } from '../packages/sim/src/arena-shrink.ts';
import { ALL_ARENAS } from '../packages/content/src/arenas.ts';
import { WISP_CHARACTER } from '../packages/content/src/characters/wisp/data.ts';
import { ANCHOR_CHARACTER } from '../packages/content/src/characters/anchor/data.ts';
import { PLACEHOLDER_CHARACTER } from '../packages/content/src/characters/placeholder/data.ts';

const arenaEntry = ALL_ARENAS.find(e => e.id === 'battle-royale-20');
const arena = arenaEntry.arena;
const ground = computeGroundHalfExtents(arena);
console.log('ground half extents', { minX: fx.toFloat(ground.minX), maxX: fx.toFloat(ground.maxX) });

// spawn x for slot 9 (outermost, human) per data.ts formula
const slot = 9;
const spawnX = 34 + slot*45;
console.log('outermost spawn x', spawnX);

// live boundary at t=1 (full field alive), tick 234
const safe = computeSafeExtents(arena, 20, 20, 234);
console.log('safe extents at tick234, 20/20 alive:', { minX: fx.toFloat(safe.minX), maxX: fx.toFloat(safe.maxX) });
const distToBoundary = fx.toFloat(safe.maxX) - spawnX;
console.log('distance spawn->boundary', distToBoundary);

// scenario: Anchor Down Air (base18, growth1.3) hits Wisp (weight 65) already at 0% before this hit -> after hit percent = dair damage
// need dair damage value -- read from data

function calc(weight, dmg, base, growth, tick) {
  const mag = computeKnockbackMagnitude(fx.fromInt(dmg), fx.fromInt(dmg), fx.fromFloat(base), fx.fromFloat(growth), fx.fromFloat(weight), tick);
  return fx.toFloat(mag);
}

console.log('EarlyScale@234', fx.toFloat(earlyMatchKnockbackScale(234)));
console.log('EarlyScale@0', fx.toFloat(earlyMatchKnockbackScale(0)));

const chars = [
  ['Wisp', 65], ['Zephyr', 75], ['Voltling', 70], ['Reed', 90], ['Scrapper', 95], ['Placeholder', 100], ['Ballast', 140], ['Anchor', 170],
];
console.log('\nAnchor Forward Tilt (dmg13, base13, growth1.0) magnitude & velocity at tick234 vs each weight:');
for (const [name, w] of chars) {
  const mag = calc(w, 13, 13.0, 1.0, 234);
  console.log(name, w, 'magnitude=', mag.toFixed(2));
}

console.log('\nSame move at tick 0 (earliest possible) vs Wisp:');
console.log('mag@0', calc(65, 13, 13.0, 1.0, 0).toFixed(2));

// ticks to cross 79.4 units at constant velocity approx (velX = mag * cos(angleIdx))

console.log('\n--- Full power (post 60s ramp) Anchor Ftilt vs Wisp ---');
console.log('mag@3600', calc(65, 13, 13.0, 1.0, 3600).toFixed(2));
console.log('EarlyScale@3600', fx.toFloat(earlyMatchKnockbackScale(3600)));

// LUT_SIZE check
import { LUT_SIZE } from '../packages/sim/src/math/fixed.ts';
console.log('LUT_SIZE', LUT_SIZE);
const angleIdx = 100;
const deg = angleIdx/LUT_SIZE*360;
console.log('Ftilt angle deg', deg);

function arcDistance(mag, angleIdxLocal) {
  const rad = angleIdxLocal/LUT_SIZE*2*Math.PI;
  const vx = mag*Math.cos(rad);
  const vy = mag*Math.sin(rad);
  const g = 0.85;
  if (vy <= 0) return { vx, vy, airTicks: 0, dist: 0 };
  const airTicks = 2*vy/g;
  return { vx, vy, airTicks, dist: vx*airTicks };
}
console.log('\nArc at tick234 (production event), Wisp defender:', arcDistance(calc(65,13,13.0,1.0,234), 100));
console.log('Arc at tick0, Wisp defender:', arcDistance(calc(65,13,13.0,1.0,0), 100));
console.log('Arc at full power (tick3600+), Wisp defender:', arcDistance(calc(65,13,13.0,1.0,3600), 100));

// strongest move dair fully powered vs Wisp -- check its angle too

console.log('\n--- Anchor Down Air (dmg18,base18,growth1.3) vs Wisp, angleIdx=768 ---');
function calc2(weight, dmg, base, growth, tick) {
  const mag = computeKnockbackMagnitude(fx.fromInt(dmg), fx.fromInt(dmg), fx.fromFloat(base), fx.fromFloat(growth), fx.fromFloat(weight), tick);
  return fx.toFloat(mag);
}
console.log('mag@234', calc2(65,18,18.0,1.3,234).toFixed(2));
console.log('arc@234 (angle768)', arcDistance(calc2(65,18,18.0,1.3,234), 768));
console.log('mag@0', calc2(65,18,18.0,1.3,0).toFixed(2));
console.log('arc@0', arcDistance(calc2(65,18,18.0,1.3,0), 768));

// worst horizontal move across all 4 chars' movesets: scan
