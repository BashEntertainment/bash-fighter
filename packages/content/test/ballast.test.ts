// Ballast character: schema validation plus a sim-level combat test
// exercising its full moveset (damage/knockback), matching the pattern in
// packages/sim/test/combat.test.ts.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Sim } from '../../sim/src/sim.ts';
import { makeInputFrame, BUTTON_ATTACK } from '../../sim/src/types.ts';
import * as fx from '../../sim/src/math/fixed.ts';
import { computeKnockbackMagnitude } from '../../sim/src/knockback.ts';
import { validateCharacter, assertValidCharacter } from '../src/validate.ts';
import { BALLAST_CHARACTER } from '../src/characters/ballast/data.ts';
import { PLACEHOLDER_CHARACTER } from '../src/characters/placeholder/data.ts';

const NEUTRAL = makeInputFrame(0, 0, 0);

function closeDistance(sim: Sim, gap: fx.Fixed): void {
  const step = fx.fromFloat(0.2);
  for (let i = 0; i < 2000; i++) {
    const f0 = sim.getFighter(0);
    const f1 = sim.getFighter(1);
    const dx = fx.sub(f1.posX, f0.posX);
    if (fx.abs(dx) <= gap) return;
    const towards = dx > 0 ? step : fx.neg(step);
    sim.advance([makeInputFrame(0, towards, 0), makeInputFrame(0, fx.neg(towards), 0)]);
  }
  throw new Error('closeDistance: never got within range');
}

describe('validateCharacter: Ballast', () => {
  it('has no validation errors', () => {
    assert.deepEqual(validateCharacter(BALLAST_CHARACTER), []);
  });

  it('assertValidCharacter does not throw', () => {
    assert.doesNotThrow(() => assertValidCharacter(BALLAST_CHARACTER));
  });

  it('is heavier than the placeholder baseline (140 vs 100)', () => {
    assert.ok(fx.toFloat(BALLAST_CHARACTER.weight) > fx.toFloat(PLACEHOLDER_CHARACTER.weight));
    assert.equal(fx.toFloat(BALLAST_CHARACTER.weight), 140);
  });
});

describe('Sim: Ballast moveset', () => {
  it('jab connects, dealing more damage than the placeholder jab', () => {
    const sim = new Sim(10, 2, [BALLAST_CHARACTER, PLACEHOLDER_CHARACTER], undefined, {
      winCondition: 'stocks',
      startingStocks: 3,
    });
    closeDistance(sim, fx.fromFloat(1.3));
    let connected = false;
    for (let i = 0; i < 20 && !connected; i++) {
      sim.advance([makeInputFrame(BUTTON_ATTACK, 0, 0), NEUTRAL]);
      if (sim.getFighter(1).percent > 0) connected = true;
    }
    assert.ok(connected, 'expected Ballast jab to connect within 20 ticks');
    // Ballast jab: damage 4 (fixed-point fromInt), vs placeholder jab's 3.
    assert.equal(fx.toFloat(sim.getFighter(1).percent), 4);
  });

  it('forward tilt does more damage and knockback than the placeholder forward tilt at the same percent', () => {
    const ballastFtilt = BALLAST_CHARACTER.moves[1];
    const placeholderFtilt = PLACEHOLDER_CHARACTER.moves[1];
    assert.ok(ballastFtilt);
    assert.ok(placeholderFtilt);
    const bHb = ballastFtilt.windows[1]?.hitboxes[0];
    const pHb = placeholderFtilt.windows[1]?.hitboxes[0];
    assert.ok(bHb);
    assert.ok(pHb);
    assert.ok(fx.toFloat(bHb.damage) > fx.toFloat(pHb.damage));

    const bMag = computeKnockbackMagnitude(
      bHb.damage,
      fx.fromInt(0),
      bHb.baseKnockback,
      bHb.knockbackGrowth,
      BALLAST_CHARACTER.weight,
    );
    const pMag = computeKnockbackMagnitude(
      pHb.damage,
      fx.fromInt(0),
      pHb.baseKnockback,
      pHb.knockbackGrowth,
      PLACEHOLDER_CHARACTER.weight,
    );
    assert.ok(
      fx.toFloat(bMag) > fx.toFloat(pMag),
      'Ballast forward tilt should launch a target harder than the placeholder forward tilt despite Ballast itself being heavier',
    );
  });

  it('Ballast takes measurably less knockback than the placeholder from an identical hit (heavyweight trade-off)', () => {
    const damage = fx.fromInt(10);
    const baseKb = fx.fromFloat(6.0);
    const kbGrowth = fx.fromFloat(0.6);
    const percentAfterHit = fx.fromInt(0);
    const magOnBallast = computeKnockbackMagnitude(damage, percentAfterHit, baseKb, kbGrowth, BALLAST_CHARACTER.weight);
    const magOnPlaceholder = computeKnockbackMagnitude(
      damage,
      percentAfterHit,
      baseKb,
      kbGrowth,
      PLACEHOLDER_CHARACTER.weight,
    );
    assert.ok(fx.toFloat(magOnBallast) < fx.toFloat(magOnPlaceholder));
    // weightTerm = 150/(weight+50): 150/190 (Ballast) vs 150/150 (placeholder)
    // = 0.7895 vs 1.0. baseKnockback is not itself weight-scaled (see the
    // formula in [[Combat Model: Knockback, Hitstun, and DI]]), so the
    // overall magnitude ratio is a blend, not exactly the weightTerm ratio
    // -- check against the formula directly instead of against the raw
    // weightTerm ratio.
    // KB_GROWTH_SCALE (see knockback.ts) uniformly scales the percent-based growth
    // term for every character; currently 1.0 (reverted 2026-09-09, see
    // [[Ring Pressure Not Executioner: 2026-09-09 Rebalance]]).
    const growthTerm = fx.toFloat(kbGrowth) * (fx.toFloat(damage) + fx.toFloat(percentAfterHit) / 2) * 0.75;
    const expectedBallast = fx.toFloat(baseKb) + growthTerm * (150 / (140 + 50));
    const expectedPlaceholder = fx.toFloat(baseKb) + growthTerm * (150 / (100 + 50));
    assert.ok(Math.abs(fx.toFloat(magOnBallast) - expectedBallast) < 0.02);
    assert.ok(Math.abs(fx.toFloat(magOnPlaceholder) - expectedPlaceholder) < 0.02);
  });
});
