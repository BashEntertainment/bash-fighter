// Wisp character: schema validation plus sim-level tests exercising its
// hit-and-run ranged skirmisher archetype (long reach like Reed, but the
// fastest startup/endlag of any ranged hitbox in the cast, lowest
// damage/knockback growth, lightest weight), matching the pattern in
// ballast.test.ts / voltling.test.ts / reed.test.ts.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Sim } from '../../sim/src/sim.ts';
import { makeInputFrame, BUTTON_ATTACK } from '../../sim/src/types.ts';
import * as fx from '../../sim/src/math/fixed.ts';
import { computeKnockbackMagnitude } from '../../sim/src/knockback.ts';
import { validateCharacter, assertValidCharacter } from '../src/validate.ts';
import { WISP_CHARACTER } from '../src/characters/wisp/data.ts';
import { REED_CHARACTER } from '../src/characters/reed/data.ts';
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

describe('validateCharacter: Wisp', () => {
  it('has no validation errors', () => {
    assert.deepEqual(validateCharacter(WISP_CHARACTER), []);
  });

  it('assertValidCharacter does not throw', () => {
    assert.doesNotThrow(() => assertValidCharacter(WISP_CHARACTER));
  });

  it('is the lightest fighter in the cast, lighter than Voltling (65 vs 70)', () => {
    assert.ok(fx.toFloat(WISP_CHARACTER.weight) < fx.toFloat(VOLTLING_CHARACTER.weight));
    assert.equal(fx.toFloat(WISP_CHARACTER.weight), 65);
  });

  it('has a narrow, slight hurtbox distinct from Reed\'s tall stalk', () => {
    assert.ok(fx.toFloat(WISP_CHARACTER.hurtboxWidth) > fx.toFloat(REED_CHARACTER.hurtboxWidth));
    assert.ok(fx.toFloat(WISP_CHARACTER.hurtboxHeight) < fx.toFloat(REED_CHARACTER.hurtboxHeight));
  });
});

describe('Sim: Wisp moveset', () => {
  it('jab connects at Reed-or-longer range', () => {
    const sim = new Sim(10, 2, [WISP_CHARACTER, PLACEHOLDER_CHARACTER], undefined, {
      winCondition: 'stocks',
      startingStocks: 3,
    });
    closeDistance(sim, fx.fromFloat(11.0));
    let connected = false;
    for (let i = 0; i < 20 && !connected; i++) {
      sim.advance([makeInputFrame(BUTTON_ATTACK, 0, 0), NEUTRAL]);
      if (sim.getFighter(1).percent > 0) connected = true;
    }
    assert.ok(connected, 'expected Wisp jab to connect within 20 ticks');
    assert.equal(fx.toFloat(sim.getFighter(1).percent), 1);
  });

  it('every move has a longer reach than the placeholder equivalent (ranged archetype)', () => {
    for (let i = 0; i < 4; i++) {
      const wMove = WISP_CHARACTER.moves[i];
      const pMove = PLACEHOLDER_CHARACTER.moves[i];
      assert.ok(wMove);
      assert.ok(pMove);
      const wHb = wMove.windows.find((w) => w.kind === 'active')?.hitboxes[0];
      const pHb = pMove.windows.find((w) => w.kind === 'active')?.hitboxes[0];
      assert.ok(wHb && pHb);
      const wReach = Math.abs(fx.toFloat(wHb.offsetX)) + Math.abs(fx.toFloat(wHb.offsetY));
      const pReach = Math.abs(fx.toFloat(pHb.offsetX)) + Math.abs(fx.toFloat(pHb.offsetY));
      assert.ok(wReach > pReach, `${wMove.name} should reach farther than the placeholder equivalent`);
    }
  });

  it('every move has faster startup and endlag than the equivalent Reed move (hit-and-run vs commit-to-poke)', () => {
    for (let i = 0; i < 4; i++) {
      const wMove = WISP_CHARACTER.moves[i];
      const rMove = REED_CHARACTER.moves[i];
      assert.ok(wMove);
      assert.ok(rMove);
      const wStartup = wMove.windows.find((w) => w.kind === 'startup');
      const rStartup = rMove.windows.find((w) => w.kind === 'startup');
      const wEndlag = wMove.windows.find((w) => w.kind === 'endlag');
      const rEndlag = rMove.windows.find((w) => w.kind === 'endlag');
      assert.ok(wStartup && rStartup && wEndlag && rEndlag);
      assert.ok(wStartup.duration < rStartup.duration, `${wMove.name} startup should be faster than Reed`);
      assert.ok(wEndlag.duration < rEndlag.duration, `${wMove.name} endlag should be shorter than Reed`);
    }
  });

  it('Wisp takes the most knockback of any fighter from an identical hit (lightest weight class)', () => {
    const damage = fx.fromInt(10);
    const baseKb = fx.fromFloat(6.0);
    const kbGrowth = fx.fromFloat(0.6);
    const percentAfterHit = fx.fromInt(0);
    const magOnWisp = computeKnockbackMagnitude(damage, percentAfterHit, baseKb, kbGrowth, WISP_CHARACTER.weight);
    const magOnVoltling = computeKnockbackMagnitude(damage, percentAfterHit, baseKb, kbGrowth, VOLTLING_CHARACTER.weight);
    const magOnPlaceholder = computeKnockbackMagnitude(
      damage,
      percentAfterHit,
      baseKb,
      kbGrowth,
      PLACEHOLDER_CHARACTER.weight,
    );
    assert.ok(fx.toFloat(magOnWisp) > fx.toFloat(magOnVoltling));
    assert.ok(fx.toFloat(magOnWisp) > fx.toFloat(magOnPlaceholder));
  });
});
