// Scrapper character: schema validation plus sim-level tests exercising its
// rushdown archetype (shortest reach, fastest startup/endlag in the cast,
// frequent pressure over single big hits), matching the pattern in
// ballast.test.ts / voltling.test.ts / reed.test.ts.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Sim } from '../../sim/src/sim.ts';
import { makeInputFrame, BUTTON_ATTACK } from '../../sim/src/types.ts';
import * as fx from '../../sim/src/math/fixed.ts';
import { computeKnockbackMagnitude } from '../../sim/src/knockback.ts';
import { validateCharacter, assertValidCharacter } from '../src/validate.ts';
import { SCRAPPER_CHARACTER } from '../src/characters/scrapper/data.ts';
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

describe('validateCharacter: Scrapper', () => {
  it('has no validation errors', () => {
    assert.deepEqual(validateCharacter(SCRAPPER_CHARACTER), []);
  });

  it('assertValidCharacter does not throw', () => {
    assert.doesNotThrow(() => assertValidCharacter(SCRAPPER_CHARACTER));
  });

  it('is close to baseline weight (95 vs 100)', () => {
    assert.equal(fx.toFloat(SCRAPPER_CHARACTER.weight), 95);
  });

  it('has a wider, shorter hurtbox than the placeholder (stocky brawler stance)', () => {
    assert.ok(fx.toFloat(SCRAPPER_CHARACTER.hurtboxWidth) > fx.toFloat(PLACEHOLDER_CHARACTER.hurtboxWidth));
    assert.ok(fx.toFloat(SCRAPPER_CHARACTER.hurtboxHeight) < fx.toFloat(PLACEHOLDER_CHARACTER.hurtboxHeight));
  });
});

describe('Sim: Scrapper moveset', () => {
  it('jab connects at point-blank range', () => {
    const sim = new Sim(10, 2, [SCRAPPER_CHARACTER, PLACEHOLDER_CHARACTER], undefined, {
      winCondition: 'stocks',
      startingStocks: 3,
    });
    closeDistance(sim, fx.fromFloat(6.0));
    let connected = false;
    for (let i = 0; i < 20 && !connected; i++) {
      sim.advance([makeInputFrame(BUTTON_ATTACK, 0, 0), NEUTRAL]);
      if (sim.getFighter(1).percent > 0) connected = true;
    }
    assert.ok(connected, 'expected Scrapper jab to connect within 20 ticks');
    assert.equal(fx.toFloat(sim.getFighter(1).percent), 2);
  });

  it('every move has shorter startup and shorter endlag than the placeholder equivalent (rushdown archetype)', () => {
    for (let i = 0; i < 4; i++) {
      const sMove = SCRAPPER_CHARACTER.moves[i];
      const pMove = PLACEHOLDER_CHARACTER.moves[i];
      assert.ok(sMove);
      assert.ok(pMove);
      const sStartup = sMove.windows.find((w) => w.kind === 'startup');
      const pStartup = pMove.windows.find((w) => w.kind === 'startup');
      const sEndlag = sMove.windows.find((w) => w.kind === 'endlag');
      const pEndlag = pMove.windows.find((w) => w.kind === 'endlag');
      assert.ok(sStartup && pStartup && sEndlag && pEndlag);
      assert.ok(sStartup.duration < pStartup.duration, `${sMove.name} startup should be faster`);
      assert.ok(sEndlag.duration < pEndlag.duration, `${sMove.name} endlag should be shorter`);
    }
  });

  it('every move has a shorter hitbox offset than the placeholder equivalent (close-range archetype)', () => {
    for (let i = 0; i < 4; i++) {
      const sMove = SCRAPPER_CHARACTER.moves[i];
      const pMove = PLACEHOLDER_CHARACTER.moves[i];
      assert.ok(sMove);
      assert.ok(pMove);
      const sHb = sMove.windows.find((w) => w.kind === 'active')?.hitboxes[0];
      const pHb = pMove.windows.find((w) => w.kind === 'active')?.hitboxes[0];
      assert.ok(sHb && pHb);
      const sReach = Math.abs(fx.toFloat(sHb.offsetX)) + Math.abs(fx.toFloat(sHb.offsetY));
      const pReach = Math.abs(fx.toFloat(pHb.offsetX)) + Math.abs(fx.toFloat(pHb.offsetY));
      assert.ok(sReach < pReach, `${sMove.name} should reach shorter than the placeholder equivalent`);
    }
  });

  it('Scrapper knockback taken from an identical hit is close to baseline (near-neutral weight)', () => {
    const damage = fx.fromInt(10);
    const baseKb = fx.fromFloat(6.0);
    const kbGrowth = fx.fromFloat(0.6);
    const percentAfterHit = fx.fromInt(0);
    const magOnScrapper = computeKnockbackMagnitude(damage, percentAfterHit, baseKb, kbGrowth, SCRAPPER_CHARACTER.weight);
    const magOnPlaceholder = computeKnockbackMagnitude(
      damage,
      percentAfterHit,
      baseKb,
      kbGrowth,
      PLACEHOLDER_CHARACTER.weight,
    );
    assert.ok(fx.toFloat(magOnScrapper) > fx.toFloat(magOnPlaceholder));
    assert.ok(Math.abs(fx.toFloat(magOnScrapper) - fx.toFloat(magOnPlaceholder)) < 0.3);
  });
});
