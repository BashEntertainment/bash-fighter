import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Sim } from '../src/sim.ts';
import { BUTTON_JUMP, makeInputFrame, type InputFrame } from '../src/types.ts';

const NO_INPUT: InputFrame[] = [makeInputFrame(), makeInputFrame()];
const JUMP: InputFrame[] = [makeInputFrame(BUTTON_JUMP), makeInputFrame()];

/** Advance with no input until velY goes negative (i.e. gravity has taken
 * over and the fighter is now falling), so tests don't have to hardcode
 * how many ticks a jump's ascent lasts. */
function advanceUntilFalling(sim: Sim, maxTicks = 60): void {
  for (let i = 0; i < maxTicks; i++) {
    if (sim.getFighter(0).velY < 0) return;
    sim.advance(NO_INPUT);
  }
  throw new Error('fighter never started falling within maxTicks');
}

describe('Sim: double jump', () => {
  it('jumps once while grounded, then again while airborne, gaining upward velocity both times', () => {
    const sim = new Sim(1, 2);

    // Grounded jump: edge-trigger fires on this tick since PREV_JUMP_HELD was 0.
    sim.advance(JUMP);
    let f0 = sim.getFighter(0);
    assert.equal(f0.grounded, false, 'should leave the ground on the first jump');
    assert.ok(f0.velY > 0, 'first jump should give upward velocity');
    assert.equal(f0.jumpsUsed, 1);

    // Release the button (an edge requires low->high) and let gravity take
    // over so the second jump is unambiguously an upward kick, not just
    // residual ascent velocity from the first jump.
    sim.advance(NO_INPUT);
    advanceUntilFalling(sim);
    assert.ok(sim.getFighter(0).velY < 0, 'fighter should be falling under gravity after release');

    // Second (aerial/double) jump.
    sim.advance(JUMP);
    f0 = sim.getFighter(0);
    assert.equal(f0.grounded, false);
    assert.ok(f0.velY > 0, 'double jump should give upward velocity again');
    assert.equal(f0.jumpsUsed, 2);
  });

  it('cannot jump a third time before landing', () => {
    const sim = new Sim(2, 2);

    sim.advance(JUMP); // jump 1 (grounded)
    sim.advance(NO_INPUT); // release edge
    advanceUntilFalling(sim);

    sim.advance(JUMP); // jump 2 (aerial/double)
    assert.equal(sim.getFighter(0).jumpsUsed, 2);

    sim.advance(NO_INPUT); // release edge
    advanceUntilFalling(sim);
    const velYBeforeAttempt = sim.getFighter(0).velY;
    assert.ok(velYBeforeAttempt < 0);

    sim.advance(JUMP); // attempted jump 3 — should be ignored
    const f0 = sim.getFighter(0);
    assert.equal(f0.jumpsUsed, 2, 'jump counter should not exceed MAX_JUMPS');
    // A real jump would snap velY to a large positive JUMP_VELOCITY; since
    // the attempt must be ignored, velY should just continue evolving under
    // gravity from where it was (still falling, i.e. still negative).
    assert.ok(f0.velY < 0, 'fighter should still be falling, not jumping a third time');
  });

  it('resets the jump counter and re-enables double jump after landing', () => {
    const sim = new Sim(3, 2);

    sim.advance(JUMP); // grounded jump
    sim.advance(NO_INPUT);
    advanceUntilFalling(sim);
    sim.advance(JUMP); // aerial jump, both jumps now used
    assert.equal(sim.getFighter(0).jumpsUsed, 2);

    // Let the fighter fall back down to the ground.
    let ticks = 0;
    while (!sim.getFighter(0).grounded && ticks < 300) {
      sim.advance(NO_INPUT);
      ticks++;
    }
    assert.ok(ticks < 300, 'fighter should land within 300 ticks');
    // One more tick grounded so the reset-on-entry logic runs.
    sim.advance(NO_INPUT);
    assert.equal(sim.getFighter(0).jumpsUsed, 0, 'landing should reset the jump counter');

    // Double jump should be available again: grounded jump then aerial jump.
    sim.advance(JUMP);
    assert.equal(sim.getFighter(0).grounded, false);
    assert.equal(sim.getFighter(0).jumpsUsed, 1);
    sim.advance(NO_INPUT);
    advanceUntilFalling(sim);
    sim.advance(JUMP);
    assert.equal(sim.getFighter(0).jumpsUsed, 2);
    assert.ok(sim.getFighter(0).velY > 0);
  });

  it('does not repeatedly fire while the jump button is held across multiple ticks', () => {
    const sim = new Sim(4, 2);

    // Hold the button down for several ticks straight, starting grounded.
    for (let i = 0; i < 10; i++) {
      sim.advance(JUMP);
    }
    const f0 = sim.getFighter(0);
    // Only the very first tick's low->high edge should count as a jump;
    // held-down input afterwards must not consume the second jump too.
    assert.equal(f0.jumpsUsed, 1, 'a held button should only trigger a single edge-jump, not both jumps back-to-back');
    assert.equal(f0.grounded, false);
  });
});
