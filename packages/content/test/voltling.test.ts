// Voltling character: schema validation plus a sim-level combat test
// exercising its full moveset (damage/knockback), matching the pattern in
// packages/content/test/ballast.test.ts and packages/sim/test/combat.test.ts.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Sim } from '../../sim/src/sim.ts';
import { makeInputFrame, BUTTON_ATTACK } from '../../sim/src/types.ts';
import * as fx from '../../sim/src/math/fixed.ts';
import { computeKnockbackMagnitude } from '../../sim/src/knockback.ts';
import { validateCharacter, assertValidCharacter } from '../src/validate.ts';
import { VOLTLING_CHARACTER } from '../src/characters/voltling/data.ts';
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

describe('validateCharacter: Voltling', () => {
  it('has no validation errors', () => {
    assert.deepEqual(validateCharacter(VOLTLING_CHARACTER), []);
  });

  it('assertValidCharacter does not throw', () => {
    assert.doesNotThrow(() => assertValidCharacter(VOLTLING_CHARACTER));
  });

  it('is lighter than the placeholder baseline (70 vs 100)', () => {
    assert.ok(fx.toFloat(VOLTLING_CHARACTER.weight) < fx.toFloat(PLACEHOLDER_CHARACTER.weight));
    assert.equal(fx.toFloat(VOLTLING_CHARACTER.weight), 70);
  });
});

describe('Sim: Voltling moveset', () => {
  it('jab connects quickly (fast startup), dealing less damage than the placeholder jab', () => {
    const sim = new Sim(10, 2, [VOLTLING_CHARACTER, PLACEHOLDER_CHARACTER], undefined, {
      winCondition: 'stocks',
      startingStocks: 3,
    });
    closeDistance(sim, fx.fromFloat(1.0));
    let connected = false;
    for (let i = 0; i < 20 && !connected; i++) {
      sim.advance([makeInputFrame(BUTTON_ATTACK, 0, 0), NEUTRAL]);
      if (sim.getFighter(1).percent > 0) connected = true;
    }
    assert.ok(connected, 'expected Voltling jab to connect within 20 ticks');
    // Voltling jab: damage 2 (fixed-point fromInt), vs placeholder jab's 3.
    assert.equal(fx.toFloat(sim.getFighter(1).percent), 2);
  });

  it('every move has lower startup and lower endlag than the placeholder equivalent (speed archetype)', () => {
    for (let i = 0; i < 4; i++) {
      const vMove = VOLTLING_CHARACTER.moves[i];
      const pMove = PLACEHOLDER_CHARACTER.moves[i];
      assert.ok(vMove);
      assert.ok(pMove);
      const vStartup = vMove.windows.find((w) => w.kind === 'startup');
      const pStartup = pMove.windows.find((w) => w.kind === 'startup');
      const vEndlag = vMove.windows.find((w) => w.kind === 'endlag');
      const pEndlag = pMove.windows.find((w) => w.kind === 'endlag');
      assert.ok(vStartup && pStartup && vEndlag && pEndlag);
      assert.ok(vStartup.duration < pStartup.duration, `${vMove.name} startup should be faster`);
      assert.ok(vEndlag.duration < pEndlag.duration, `${vMove.name} endlag should be shorter`);
    }
  });

  it('forward tilt does less damage but more knockback growth than the placeholder forward tilt', () => {
    const vFtilt = VOLTLING_CHARACTER.moves[1];
    const pFtilt = PLACEHOLDER_CHARACTER.moves[1];
    assert.ok(vFtilt);
    assert.ok(pFtilt);
    const vHb = vFtilt.windows[1]?.hitboxes[0];
    const pHb = pFtilt.windows[1]?.hitboxes[0];
    assert.ok(vHb);
    assert.ok(pHb);
    assert.ok(fx.toFloat(vHb.damage) < fx.toFloat(pHb.damage));
    assert.ok(fx.toFloat(vHb.knockbackGrowth) > fx.toFloat(pHb.knockbackGrowth));
  });

  it('Voltling takes measurably more knockback than the placeholder from an identical hit (glass-cannon trade-off)', () => {
    const damage = fx.fromInt(10);
    const baseKb = fx.fromFloat(6.0);
    const kbGrowth = fx.fromFloat(0.6);
    const percentAfterHit = fx.fromInt(0);
    const magOnVoltling = computeKnockbackMagnitude(damage, percentAfterHit, baseKb, kbGrowth, VOLTLING_CHARACTER.weight);
    const magOnPlaceholder = computeKnockbackMagnitude(
      damage,
      percentAfterHit,
      baseKb,
      kbGrowth,
      PLACEHOLDER_CHARACTER.weight,
    );
    assert.ok(fx.toFloat(magOnVoltling) > fx.toFloat(magOnPlaceholder));
    // weightTerm = 150/(weight+50): 150/120 (Voltling) vs 150/150 (placeholder)
    // = 1.25 vs 1.0. baseKnockback is not itself weight-scaled (see the
    // formula in [[Combat Model: Knockback, Hitstun, and DI]]), so check
    // against the formula directly instead of against the raw weightTerm
    // ratio.
    // KB_GROWTH_SCALE (1.3) uniformly scales the percent-based growth term for every
    // character -- see 2026-09-09 rebalance in [[Bot Combat Engagement Fix 2026-09-09]] follow-up.
    const growthTerm = fx.toFloat(kbGrowth) * (fx.toFloat(damage) + fx.toFloat(percentAfterHit) / 2) * 1.3;
    const expectedVoltling = fx.toFloat(baseKb) + growthTerm * (150 / (70 + 50));
    const expectedPlaceholder = fx.toFloat(baseKb) + growthTerm * (150 / (100 + 50));
    assert.ok(Math.abs(fx.toFloat(magOnVoltling) - expectedVoltling) < 0.02);
    assert.ok(Math.abs(fx.toFloat(magOnPlaceholder) - expectedPlaceholder) < 0.02);
  });
});
