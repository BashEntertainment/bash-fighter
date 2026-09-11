// Regression test for the ?crowd20=1 local-crowd-QA debug harness (see
// docs/LOCAL_CROWD_TESTING.md and wiki "Local Crowd Testing Tool
// 2026-09-11"). Before the fix, a local match built with more than the 2
// fighters InputManager drives threw "advance: expected N inputs, got 2"
// on the very first tick, because nothing produced an InputFrame for
// slots 2..N-1 -- crowd20 filled 20 character slots but Match.tick()
// still only polled 2 local input slots. That is exactly why another
// agent could not get ?crowd20=1 working and dropped it.
//
// No jsdom here (npm registry is blocked for agents -- see "Sim Core
// Implementation Notes"), so this exercises match.ts's buildLocalBots/
// buildTickInputs helpers directly against a real Sim for many ticks,
// which is the whole of the logic that was broken -- it needs no
// Renderer/canvas/DOM at all.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMatchSim, ALL_CHARACTERS, pickArenaId } from '@bash-fighter/content';
import { buildLocalBots, buildTickInputs } from '../src/local-crowd-bots.ts';

const N = 20;
const SEED = 424242;
const HUMAN_SLOT_COUNT = 2;

function crowdCharacters() {
  return Array.from({ length: N }, (_, i) => ALL_CHARACTERS[i % ALL_CHARACTERS.length]!.character);
}

test('a 20-fighter crowd match advances many ticks without throwing', () => {
  const characters = crowdCharacters();
  const sim = createMatchSim(SEED, N, undefined, characters, pickArenaId(SEED));
  const bots = buildLocalBots(SEED, N, HUMAN_SLOT_COUNT);

  // Every non-human slot must have a bot, or Sim.advance() is exactly
  // the "expected N inputs, got fewer" crash this test guards against.
  for (let slot = HUMAN_SLOT_COUNT; slot < N; slot++) {
    assert.ok(bots.has(slot), `slot ${slot} has no bot`);
  }

  const idlePolled = [];
  for (let i = 0; i < HUMAN_SLOT_COUNT; i++) idlePolled.push({ buttons: 0, stickX: 0, stickY: 0 });

  // 600 ticks (~10s at 60Hz) is enough to run well past the opening
  // scrum where bots first start throwing hitboxes -- the case that
  // actually exercises BotController.nextInput's targeting/attack paths,
  // not just idle movement.
  for (let tick = 0; tick < 600; tick++) {
    const inputs = buildTickInputs(sim, idlePolled, bots, N);
    assert.equal(inputs.length, N, `tick ${tick}: input frame count must match fighter count`);
    assert.doesNotThrow(() => sim.advance(inputs), `tick ${tick} threw`);
  }

  // Sanity: a real 20-fighter free-for-all run this long has damaged or
  // eliminated somebody -- if every fighter is still at 0% untouched,
  // the bots never actually acted and this test would be vacuous.
  let anyDamageOrElimination = false;
  for (let i = 0; i < N; i++) {
    const f = sim.getFighter(i);
    if (f.percent > 0 || f.stocks < 1) anyDamageOrElimination = true;
  }
  assert.ok(anyDamageOrElimination, 'no fighter took damage or was eliminated in 600 ticks -- bots did not act');
});

test('buildLocalBots leaves human slots (0..humanSlotCount-1) uncontrolled by a bot', () => {
  const bots = buildLocalBots(SEED, N, HUMAN_SLOT_COUNT);
  for (let slot = 0; slot < HUMAN_SLOT_COUNT; slot++) {
    assert.equal(bots.has(slot), false, `slot ${slot} should be human-controlled, not a bot`);
  }
});

test('a crowd match is reproducible for a given seed', () => {
  const characters = crowdCharacters();
  const simA = createMatchSim(SEED, N, undefined, characters, pickArenaId(SEED));
  const simB = createMatchSim(SEED, N, undefined, characters, pickArenaId(SEED));
  const botsA = buildLocalBots(SEED, N, HUMAN_SLOT_COUNT);
  const botsB = buildLocalBots(SEED, N, HUMAN_SLOT_COUNT);
  const idlePolled = Array.from({ length: HUMAN_SLOT_COUNT }, () => ({ buttons: 0, stickX: 0, stickY: 0 }));

  for (let tick = 0; tick < 120; tick++) {
    simA.advance(buildTickInputs(simA, idlePolled, botsA, N));
    simB.advance(buildTickInputs(simB, idlePolled, botsB, N));
  }

  const bufA = simA.createStateBuffer();
  const bufB = simB.createStateBuffer();
  simA.saveState(bufA);
  simB.saveState(bufB);
  assert.deepEqual(Array.from(bufA), Array.from(bufB));
});
