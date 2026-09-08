// Anchor character: schema validation plus sim-level tests exercising its
// grappler-flavoured super-heavyweight archetype (heaviest weight, biggest
// hitboxes, slowest startup/endlag in the cast), matching the pattern in
// ballast.test.ts / voltling.test.ts / reed.test.ts.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Sim } from '../../sim/src/sim.ts';
import { makeInputFrame, BUTTON_ATTACK } from '../../sim/src/types.ts';
import * as fx from '../../sim/src/math/fixed.ts';
import { computeKnockbackMagnitude } from '../../sim/src/knockback.ts';
import { validateCharacter, assertValidCharacter } from '../src/validate.ts';
import { ANCHOR_CHARACTER } from '../src/characters/anchor/data.ts';
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

describe('validateCharacter: Anchor', () => {
  it('has no validation errors', () => {
    assert.deepEqual(validateCharacter(ANCHOR_CHARACTER), []);
  });

  it('assertValidCharacter does not throw', () => {
    assert.doesNotThrow(() => assertValidCharacter(ANCHOR_CHARACTER));
  });

  it('is the heaviest fighter in the cast, heavier than Ballast (170 vs 140)', () => {
    assert.ok(fx.toFloat(ANCHOR_CHARACTER.weight) > fx.toFloat(BALLAST_CHARACTER.weight));
    assert.equal(fx.toFloat(ANCHOR_CHARACTER.weight), 170);
  });

  it('has the widest and tallest hurtbox in the cast, bigger than Ballast in both dimensions', () => {
    assert.ok(fx.toFloat(ANCHOR_CHARACTER.hurtboxWidth) > fx.toFloat(BALLAST_CHARACTER.hurtboxWidth));
    assert.ok(fx.toFloat(ANCHOR_CHARACTER.hurtboxHeight) > fx.toFloat(BALLAST_CHARACTER.hurtboxHeight));
  });
});

describe('Sim: Anchor moveset', () => {
  it('jab connects and deals more damage than the placeholder jab', () => {
    const sim = new Sim(10, 2, [ANCHOR_CHARACTER, PLACEHOLDER_CHARACTER], undefined, {
      winCondition: 'stocks',
      startingStocks: 3,
    });
    closeDistance(sim, fx.fromFloat(14.0));
    let connected = false;
    for (let i = 0; i < 30 && !connected; i++) {
      sim.advance([makeInputFrame(BUTTON_ATTACK, 0, 0), NEUTRAL]);
      if (sim.getFighter(1).percent > 0) connected = true;
    }
    assert.ok(connected, 'expected Anchor jab to connect within 30 ticks');
    assert.equal(fx.toFloat(sim.getFighter(1).percent), 6);
  });

  it('every move has slower startup and longer endlag than Ballast equivalent (slowest in the cast)', () => {
    for (let i = 0; i < 4; i++) {
      const aMove = ANCHOR_CHARACTER.moves[i];
      const bMove = BALLAST_CHARACTER.moves[i];
      assert.ok(aMove);
      assert.ok(bMove);
      const aStartup = aMove.windows.find((w) => w.kind === 'startup');
      const bStartup = bMove.windows.find((w) => w.kind === 'startup');
      const aEndlag = aMove.windows.find((w) => w.kind === 'endlag');
      const bEndlag = bMove.windows.find((w) => w.kind === 'endlag');
      assert.ok(aStartup && bStartup && aEndlag && bEndlag);
      assert.ok(aStartup.duration > bStartup.duration, `${aMove.name} startup should be slower than Ballast`);
      assert.ok(aEndlag.duration > bEndlag.duration, `${aMove.name} endlag should be longer than Ballast`);
    }
  });

  it('every move deals more damage than the Ballast equivalent (hardest hitting in the cast)', () => {
    for (let i = 0; i < 4; i++) {
      const aMove = ANCHOR_CHARACTER.moves[i];
      const bMove = BALLAST_CHARACTER.moves[i];
      assert.ok(aMove);
      assert.ok(bMove);
      const aHb = aMove.windows.find((w) => w.kind === 'active')?.hitboxes[0];
      const bHb = bMove.windows.find((w) => w.kind === 'active')?.hitboxes[0];
      assert.ok(aHb && bHb);
      assert.ok(fx.toFloat(aHb.damage) > fx.toFloat(bHb.damage), `${aMove.name} should hit harder than Ballast`);
    }
  });

  it('Anchor takes the least knockback of any fighter from an identical hit (heaviest weight class)', () => {
    const damage = fx.fromInt(10);
    const baseKb = fx.fromFloat(6.0);
    const kbGrowth = fx.fromFloat(0.6);
    const percentAfterHit = fx.fromInt(0);
    const magOnAnchor = computeKnockbackMagnitude(damage, percentAfterHit, baseKb, kbGrowth, ANCHOR_CHARACTER.weight);
    const magOnBallast = computeKnockbackMagnitude(damage, percentAfterHit, baseKb, kbGrowth, BALLAST_CHARACTER.weight);
    const magOnPlaceholder = computeKnockbackMagnitude(
      damage,
      percentAfterHit,
      baseKb,
      kbGrowth,
      PLACEHOLDER_CHARACTER.weight,
    );
    assert.ok(fx.toFloat(magOnAnchor) < fx.toFloat(magOnBallast));
    assert.ok(fx.toFloat(magOnAnchor) < fx.toFloat(magOnPlaceholder));
  });
});
