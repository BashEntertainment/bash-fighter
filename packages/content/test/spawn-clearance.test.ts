// Permanent regression test for the spawn-clearance defect class (see
// wiki "Spawn Clearance Audit: All Stages 2026-09-11"): a fighter spawned
// too close to the live tick-0 boundary can be genuinely knocked out in
// the opening seconds by an ordinary early hit, before the ring has even
// started shrinking. This asserts every spawn slot on every shipped
// stage keeps a safety margin over the worst-case early-hit arc, so a
// contributor adding a stage (or moving a spawn) finds out immediately
// instead of it surfacing as a live-production bug days later.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ALL_ARENAS } from '../src/arenas.ts';
import { computeWorstCaseArc, computeStageClearance, HORIZ_SAFETY_FACTOR, VERT_SAFETY_FACTOR } from '../src/spawn-clearance/compute.ts';

const worst = computeWorstCaseArc();

describe('Spawn clearance vs worst-case early-hit arc', () => {
  it('the computed worst-case arc is non-trivial (sanity check the fixture roster is loaded)', () => {
    assert.ok(worst.horiz > 10, `worst-case horizontal arc suspiciously small: ${worst.horiz}`);
  });

  for (const { id, arena } of ALL_ARENAS) {
    const results = computeStageClearance(arena, worst);

    it(`${id}: every spawn slot clears the worst-case horizontal arc by >= ${HORIZ_SAFETY_FACTOR}x`, () => {
      const shortfalls = results.filter(r => r.horizFactor < HORIZ_SAFETY_FACTOR);
      assert.deepEqual(
        shortfalls.map(s => `slot ${s.slot} (x=${s.x.toFixed(0)}): factor ${s.horizFactor.toFixed(2)}`),
        [],
        `${id} has spawn slots too close to the horizontal boundary`,
      );
    });

    it(`${id}: every spawn slot clears the worst-case ceiling arc by >= ${VERT_SAFETY_FACTOR}x`, () => {
      const shortfalls = results.filter(r => r.vertFactor < VERT_SAFETY_FACTOR);
      assert.deepEqual(
        shortfalls.map(s => `slot ${s.slot} (y=${s.y.toFixed(0)}): factor ${s.vertFactor.toFixed(2)}`),
        [],
        `${id} has spawn slots too close to the ceiling boundary`,
      );
    });
  }
});
