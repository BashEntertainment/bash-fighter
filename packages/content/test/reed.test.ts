// Reed character: schema validation plus sim-level tests exercising its
// zoner archetype (long reach, long commitment, moderate knockback
// growth), matching the pattern in ballast.test.ts / voltling.test.ts.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Sim } from '../../sim/src/sim.ts';
import { makeInputFrame, BUTTON_ATTACK } from '../../sim/src/types.ts';
import * as fx from '../../sim/src/math/fixed.ts';
import { computeKnockbackMagnitude } from '../../sim/src/knockback.ts';
import { validateCharacter, assertValidCharacter } from '../src/validate.ts';
import { REED_CHARACTER } from '../src/characters/reed/data.ts';
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

describe('validateCharacter: Reed', () => {
  it('has no validation errors', () => {
    assert.deepEqual(validateCharacter(REED_CHARACTER), []);
  });

  it('assertValidCharacter does not throw', () => {
    assert.doesNotThrow(() => assertValidCharacter(REED_CHARACTER));
  });

  it('is lighter than the placeholder baseline (90 vs 100)', () => {
    assert.ok(fx.toFloat(REED_CHARACTER.weight) < fx.toFloat(PLACEHOLDER_CHARACTER.weight));
    assert.equal(fx.toFloat(REED_CHARACTER.weight), 90);
  });

  it('has a narrower but taller hurtbox than the placeholder (slim reed shape)', () => {
    assert.ok(fx.toFloat(REED_CHARACTER.hurtboxWidth) < fx.toFloat(PLACEHOLDER_CHARACTER.hurtboxWidth));
    assert.ok(fx.toFloat(REED_CHARACTER.hurtboxHeight) > fx.toFloat(PLACEHOLDER_CHARACTER.hurtboxHeight));
  });
});

describe('Sim: Reed moveset', () => {
  it('jab connects and deals less damage than the placeholder jab', () => {
    const sim = new Sim(10, 2, [REED_CHARACTER, PLACEHOLDER_CHARACTER], undefined, {
      winCondition: 'stocks',
      startingStocks: 3,
    });
    // Reed's jab reaches out to offsetX 14 (further than a typical
    // point-blank jab), so close to within that reach rather than to
    // point-blank range -- see hitbox-geometry.test.ts's point-blank-on-
    // the-authored-offset check for the geometry-only version of this.
    closeDistance(sim, fx.fromFloat(12.0));
    let connected = false;
    for (let i = 0; i < 20 && !connected; i++) {
      sim.advance([makeInputFrame(BUTTON_ATTACK, 0, 0), NEUTRAL]);
      if (sim.getFighter(1).percent > 0) connected = true;
    }
    assert.ok(connected, 'expected Reed jab to connect within 20 ticks');
    // Reed jab: damage 2 (fixed-point fromInt), vs placeholder jab's 3.
    assert.equal(fx.toFloat(sim.getFighter(1).percent), 2);
  });

  it('every move has a longer horizontal/vertical hitbox offset than the placeholder equivalent (reach archetype)', () => {
    for (let i = 0; i < 4; i++) {
      const rMove = REED_CHARACTER.moves[i];
      const pMove = PLACEHOLDER_CHARACTER.moves[i];
      assert.ok(rMove);
      assert.ok(pMove);
      const rHb = rMove.windows.find((w) => w.kind === 'active')?.hitboxes[0];
      const pHb = pMove.windows.find((w) => w.kind === 'active')?.hitboxes[0];
      assert.ok(rHb && pHb);
      const rReach = Math.abs(fx.toFloat(rHb.offsetX)) + Math.abs(fx.toFloat(rHb.offsetY));
      const pReach = Math.abs(fx.toFloat(pHb.offsetX)) + Math.abs(fx.toFloat(pHb.offsetY));
      assert.ok(rReach > pReach, `${rMove.name} should reach farther than the placeholder equivalent`);
    }
  });

  it('every move has longer startup and longer endlag than the placeholder equivalent (commitment archetype)', () => {
    for (let i = 0; i < 4; i++) {
      const rMove = REED_CHARACTER.moves[i];
      const pMove = PLACEHOLDER_CHARACTER.moves[i];
      assert.ok(rMove);
      assert.ok(pMove);
      const rStartup = rMove.windows.find((w) => w.kind === 'startup');
      const pStartup = pMove.windows.find((w) => w.kind === 'startup');
      const rEndlag = rMove.windows.find((w) => w.kind === 'endlag');
      const pEndlag = pMove.windows.find((w) => w.kind === 'endlag');
      assert.ok(rStartup && pStartup && rEndlag && pEndlag);
      assert.ok(rStartup.duration > pStartup.duration, `${rMove.name} startup should be slower`);
      assert.ok(rEndlag.duration > pEndlag.duration, `${rMove.name} endlag should be longer`);
    }
  });

  it('Reed takes measurably more knockback than the placeholder from an identical hit (light keep-away trade-off)', () => {
    const damage = fx.fromInt(10);
    const baseKb = fx.fromFloat(6.0);
    const kbGrowth = fx.fromFloat(0.6);
    const percentAfterHit = fx.fromInt(0);
    const magOnReed = computeKnockbackMagnitude(damage, percentAfterHit, baseKb, kbGrowth, REED_CHARACTER.weight);
    const magOnPlaceholder = computeKnockbackMagnitude(
      damage,
      percentAfterHit,
      baseKb,
      kbGrowth,
      PLACEHOLDER_CHARACTER.weight,
    );
    assert.ok(fx.toFloat(magOnReed) > fx.toFloat(magOnPlaceholder));
    // KB_GROWTH_SCALE (see knockback.ts) uniformly scales the percent-based growth
    // term for every character; currently 1.0 (reverted 2026-09-09, see
    // [[Ring Pressure Not Executioner: 2026-09-09 Rebalance]]).
    const growthTerm = fx.toFloat(kbGrowth) * (fx.toFloat(damage) + fx.toFloat(percentAfterHit) / 2) * 1.0;
    const expectedReed = fx.toFloat(baseKb) + growthTerm * (150 / (90 + 50));
    const expectedPlaceholder = fx.toFloat(baseKb) + growthTerm * (150 / (100 + 50));
    assert.ok(Math.abs(fx.toFloat(magOnReed) - expectedReed) < 0.02);
    assert.ok(Math.abs(fx.toFloat(magOnPlaceholder) - expectedPlaceholder) < 0.02);
  });
});
