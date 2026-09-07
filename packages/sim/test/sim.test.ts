import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Sim, GROUND_Y, STAGE_MIN_X, STAGE_MAX_X } from '../src/sim.ts';
import { BUTTON_JUMP, makeInputFrame, type InputFrame } from '../src/types.ts';
import { ONE, fromInt } from '../src/math/fixed.ts';
import { FighterStateId } from '../src/entities/fighter.ts';

const NO_INPUT: InputFrame[] = [makeInputFrame(), makeInputFrame()];

describe('Sim: initial state', () => {
  it('starts both fighters grounded, idle, at their spawn positions', () => {
    const sim = new Sim(1);
    const f0 = sim.getFighter(0);
    const f1 = sim.getFighter(1);
    assert.equal(f0.grounded, true);
    assert.equal(f1.grounded, true);
    assert.equal(f0.state, FighterStateId.IDLE);
    assert.equal(f0.posY, GROUND_Y);
    assert.equal(f1.posY, GROUND_Y);
    assert.ok(f0.posX < f1.posX);
  });
});

describe('Sim: gravity and ground collision', () => {
  it('a fighter that jumps eventually returns to the ground', () => {
    const sim = new Sim(1);
    const jumpInput = makeInputFrame(BUTTON_JUMP);
    sim.advance([jumpInput, makeInputFrame()]);
    assert.equal(sim.getFighter(0).grounded, false);
    let ticks = 0;
    while (!sim.getFighter(0).grounded && ticks < 300) {
      sim.advance(NO_INPUT);
      ticks++;
    }
    assert.ok(ticks < 300, 'fighter should land within 300 ticks');
    assert.equal(sim.getFighter(0).posY, GROUND_Y);
  });

  it('never sinks below GROUND_Y even over many ticks', () => {
    const sim = new Sim(2);
    for (let i = 0; i < 600; i++) {
      sim.advance(NO_INPUT);
      assert.ok(sim.getFighter(0).posY >= GROUND_Y);
      assert.ok(sim.getFighter(1).posY >= GROUND_Y);
    }
  });
});

describe('Sim: horizontal movement', () => {
  it('moving right increases posX and stays within stage bounds', () => {
    const sim = new Sim(3);
    const startX = sim.getFighter(0).posX;
    const right = makeInputFrame(0, ONE, 0);
    for (let i = 0; i < 5; i++) {
      sim.advance([right, makeInputFrame()]);
    }
    const f0 = sim.getFighter(0);
    assert.ok(f0.posX > startX);
    assert.equal(f0.facing, 1);
    assert.ok(f0.posX <= STAGE_MAX_X);
  });

  it('clamps position at stage edges instead of allowing escape', () => {
    const sim = new Sim(4);
    const left = makeInputFrame(0, fromInt(-1), 0);
    for (let i = 0; i < 1000; i++) {
      sim.advance([left, makeInputFrame()]);
    }
    assert.equal(sim.getFighter(0).posX, STAGE_MIN_X);
  });
});

describe('Sim: saveState/loadState round trip', () => {
  it('restores identical fighter state after loadState', () => {
    const sim = new Sim(5);
    const buf = sim.createStateBuffer();
    const jumpInput = makeInputFrame(BUTTON_JUMP);
    sim.advance([jumpInput, makeInputFrame(0, ONE, 0)]);
    sim.advance(NO_INPUT);
    sim.saveState(buf);
    const before = JSON.stringify([sim.getFighter(0), sim.getFighter(1), sim.getTick()]);

    // Diverge, then restore, and confirm we are back to the saved snapshot.
    for (let i = 0; i < 10; i++) sim.advance(NO_INPUT);
    assert.notEqual(JSON.stringify([sim.getFighter(0), sim.getFighter(1), sim.getTick()]), before);

    sim.loadState(buf);
    const after = JSON.stringify([sim.getFighter(0), sim.getFighter(1), sim.getTick()]);
    assert.equal(after, before);
  });

  it('rejects a buffer of the wrong size', () => {
    const sim = new Sim(1);
    const bad = new Int32Array(3);
    assert.throws(() => sim.saveState(bad), RangeError);
    assert.throws(() => sim.loadState(bad), RangeError);
  });
});

describe('Sim: advance() input validation', () => {
  it('throws if given the wrong number of input frames', () => {
    const sim = new Sim(1);
    assert.throws(() => sim.advance([makeInputFrame()]), RangeError);
  });
});
