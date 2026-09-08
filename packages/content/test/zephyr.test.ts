// Zephyr character: schema validation plus sim-level tests exercising its
// acrobatic/mobility archetype (fast aerial startup with long active
// windows, below-baseline knockback growth on every move), matching the
// pattern in ballast.test.ts / voltling.test.ts / reed.test.ts.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Sim } from '../../sim/src/sim.ts';
import { makeInputFrame, BUTTON_ATTACK } from '../../sim/src/types.ts';
import * as fx from '../../sim/src/math/fixed.ts';
import { computeKnockbackMagnitude } from '../../sim/src/knockback.ts';
import { validateCharacter, assertValidCharacter } from '../src/validate.ts';
import { ZEPHYR_CHARACTER } from '../src/characters/zephyr/data.ts';
import { VOLTLING_CHARACTER } from '../src/characters/voltling/data.ts';
import { PLACEHOLDER_CHARACTER } from '../src/characters/placeholder/data.ts';
import { MoveId } from '../../sim/src/moves/types.ts';

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

describe('validateCharacter: Zephyr', () => {
  it('has no validation errors', () => {
    assert.deepEqual(validateCharacter(ZEPHYR_CHARACTER), []);
  });

  it('assertValidCharacter does not throw', () => {
    assert.doesNotThrow(() => assertValidCharacter(ZEPHYR_CHARACTER));
  });

  it('is light, between Voltling and the placeholder baseline (75)', () => {
    assert.equal(fx.toFloat(ZEPHYR_CHARACTER.weight), 75);
    assert.ok(fx.toFloat(ZEPHYR_CHARACTER.weight) > fx.toFloat(VOLTLING_CHARACTER.weight));
    assert.ok(fx.toFloat(ZEPHYR_CHARACTER.weight) < fx.toFloat(PLACEHOLDER_CHARACTER.weight));
  });

  it('has the shortest hurtbox in the cast (low, coiled stance)', () => {
    assert.ok(fx.toFloat(ZEPHYR_CHARACTER.hurtboxHeight) < fx.toFloat(VOLTLING_CHARACTER.hurtboxHeight));
  });
});

describe('Sim: Zephyr moveset', () => {
  it('jab connects at close range', () => {
    const sim = new Sim(10, 2, [ZEPHYR_CHARACTER, PLACEHOLDER_CHARACTER], undefined, {
      winCondition: 'stocks',
      startingStocks: 3,
    });
    closeDistance(sim, fx.fromFloat(7.0));
    let connected = false;
    for (let i = 0; i < 20 && !connected; i++) {
      sim.advance([makeInputFrame(BUTTON_ATTACK, 0, 0), NEUTRAL]);
      if (sim.getFighter(1).percent > 0) connected = true;
    }
    assert.ok(connected, 'expected Zephyr jab to connect within 20 ticks');
    assert.equal(fx.toFloat(sim.getFighter(1).percent), 2);
  });

  it('both aerials have a longer active window than the placeholder equivalent (lingering air threat)', () => {
    const zUair = ZEPHYR_CHARACTER.moves.find((m) => m.id === MoveId.UAIR);
    const pUair = PLACEHOLDER_CHARACTER.moves.find((m) => m.id === MoveId.UAIR);
    const zDair = ZEPHYR_CHARACTER.moves.find((m) => m.id === MoveId.DAIR);
    const pDair = PLACEHOLDER_CHARACTER.moves.find((m) => m.id === MoveId.DAIR);
    assert.ok(zUair && pUair && zDair && pDair);
    const zUairActive = zUair.windows.find((w) => w.kind === 'active');
    const pUairActive = pUair.windows.find((w) => w.kind === 'active');
    const zDairActive = zDair.windows.find((w) => w.kind === 'active');
    const pDairActive = pDair.windows.find((w) => w.kind === 'active');
    assert.ok(zUairActive && pUairActive && zDairActive && pDairActive);
    assert.ok(zUairActive.duration > pUairActive.duration);
    assert.ok(zDairActive.duration >= pDairActive.duration);
  });

  it('every move has knockback growth at or below the placeholder equivalent (out-stay, not out-hit)', () => {
    for (let i = 0; i < 4; i++) {
      const zMove = ZEPHYR_CHARACTER.moves[i];
      const pMove = PLACEHOLDER_CHARACTER.moves[i];
      assert.ok(zMove);
      assert.ok(pMove);
      const zHb = zMove.windows.find((w) => w.kind === 'active')?.hitboxes[0];
      const pHb = pMove.windows.find((w) => w.kind === 'active')?.hitboxes[0];
      assert.ok(zHb && pHb);
      assert.ok(
        fx.toFloat(zHb.knockbackGrowth) <= fx.toFloat(pHb.knockbackGrowth),
        `${zMove.name} knockback growth should be at or below baseline`,
      );
    }
  });

  it('Zephyr takes more knockback than the placeholder from an identical hit (fragile mobility archetype)', () => {
    const damage = fx.fromInt(10);
    const baseKb = fx.fromFloat(6.0);
    const kbGrowth = fx.fromFloat(0.6);
    const percentAfterHit = fx.fromInt(0);
    const magOnZephyr = computeKnockbackMagnitude(damage, percentAfterHit, baseKb, kbGrowth, ZEPHYR_CHARACTER.weight);
    const magOnPlaceholder = computeKnockbackMagnitude(
      damage,
      percentAfterHit,
      baseKb,
      kbGrowth,
      PLACEHOLDER_CHARACTER.weight,
    );
    assert.ok(fx.toFloat(magOnZephyr) > fx.toFloat(magOnPlaceholder));
  });
});
