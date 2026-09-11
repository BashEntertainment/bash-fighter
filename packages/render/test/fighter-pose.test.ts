// Unit tests for packages/render/src/fighter-pose.ts's pose interpolation
// (issue #23). Pure computation, no Pixi/DOM involved -- inputs are sim
// state values plus an existing character's AnimationParams
// (Placeholder), matching the style of palette.test.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computePose, NEUTRAL_POSE, type PoseInput } from '../src/fighter-pose.ts';
import { FighterStateId, MoveId } from '@bash-fighter/sim';
import { PLACEHOLDER_ANIMATION, PLACEHOLDER_CHARACTER } from '@bash-fighter/content';

const anim = PLACEHOLDER_ANIMATION;
const character = PLACEHOLDER_CHARACTER;

function baseInput(overrides: Partial<PoseInput> = {}): PoseInput {
  return {
    state: FighterStateId.IDLE,
    stateTicks: 0,
    moveId: -1,
    moveFrame: 0,
    hitstun: 0,
    facing: 1,
    character,
    anim,
    ...overrides,
  };
}

test('idle pose at tick 0 is the neutral pose (breathe term is zero)', () => {
  const pose = computePose(baseInput({ state: FighterStateId.IDLE, stateTicks: 0 }));
  assert.equal(pose.bodyLean, NEUTRAL_POSE.bodyLean);
  assert.equal(pose.limbAngle, NEUTRAL_POSE.limbAngle);
  assert.equal(pose.limbExtend, NEUTRAL_POSE.limbExtend);
  // sin(0) == 0, so scale/bob stay at their neutral values too.
  assert.equal(pose.bodyScaleY, 1);
  assert.equal(pose.bodyScaleX, 1);
  assert.equal(pose.bodyBob, 0);
});

test('idle breathing is periodic, not monotonically increasing', () => {
  const samples: number[] = [];
  for (let t = 0; t < 200; t++) {
    samples.push(computePose(baseInput({ state: FighterStateId.IDLE, stateTicks: t })).bodyScaleY);
  }
  // A monotonically increasing sequence would never come back down;
  // breathing must both rise and fall across the sampled window.
  let roseThenFell = false;
  let peaked = false;
  for (let i = 1; i < samples.length; i++) {
    if (samples[i]! < samples[i - 1]!) peaked = true;
    if (peaked && samples[i]! > samples[i - 1]!) roseThenFell = true;
  }
  assert.ok(peaked, 'expected bodyScaleY to decrease at some point');
  assert.ok(roseThenFell, 'expected bodyScaleY to rise again after decreasing (periodic)');
});

test('run cycle produces a periodic limb swing, not a monotonic ramp', () => {
  const values: number[] = [];
  for (let t = 0; t < 400; t++) {
    values.push(computePose(baseInput({ state: FighterStateId.RUN, stateTicks: t })).limbAngle);
  }
  const max = Math.max(...values);
  const min = Math.min(...values);
  // sin-based swing should cross back near zero and go negative too.
  assert.ok(max > 0.1, `expected a positive swing peak, got max=${max}`);
  assert.ok(min < -0.1, `expected a negative swing trough, got min=${min}`);
  // Bounded by facing * runLimbSwing (facing=1 here).
  assert.ok(max <= anim.runLimbSwing + 1e-9);
  assert.ok(min >= -anim.runLimbSwing - 1e-9);
});

test('run pose sets a fixed forward limb extension and lean', () => {
  const pose = computePose(baseInput({ state: FighterStateId.RUN, stateTicks: 5 }));
  assert.equal(pose.limbExtend, 0.6);
  assert.equal(pose.bodyLean, anim.runLean);
});

test('attack startup window: pose progression grows in magnitude across the window', () => {
  // Jab: startup duration 3 (frames 0,1,2).
  const p0 = computePose(baseInput({ state: FighterStateId.ATTACK, moveId: MoveId.JAB, moveFrame: 0 }));
  const p1 = computePose(baseInput({ state: FighterStateId.ATTACK, moveId: MoveId.JAB, moveFrame: 1 }));
  const p2 = computePose(baseInput({ state: FighterStateId.ATTACK, moveId: MoveId.JAB, moveFrame: 2 }));
  // frac = frameInWindow / (duration - 1), so 0, 0.5, 1.
  assert.ok(Math.abs(p0.limbAngle) < 1e-9);
  assert.ok(Math.abs(p1.limbAngle) > Math.abs(p0.limbAngle));
  assert.ok(Math.abs(p2.limbAngle) > Math.abs(p1.limbAngle));
  // Windup leans/swings *away* from facing (negative for facing=1).
  assert.ok(p2.limbAngle < 0);
  const expectedDepth = anim.windup * anim.attackTimingScale * 1; // frac=1 at last startup frame
  assert.ok(Math.abs(p2.limbAngle - -expectedDepth) < 1e-9);
});

test('attack active window: limb reaches full extension and sweeps toward facing', () => {
  // Jab: startup=3 (frames 0-2), active=2 (frames 3-4).
  const pStart = computePose(baseInput({ state: FighterStateId.ATTACK, moveId: MoveId.JAB, moveFrame: 3 }));
  const pEnd = computePose(baseInput({ state: FighterStateId.ATTACK, moveId: MoveId.JAB, moveFrame: 4 }));
  assert.equal(pStart.limbExtend, 1);
  assert.equal(pEnd.limbExtend, 1);
  // reach = 0.3 + 0.7*frac; frac goes 0 -> 1 across the 2-frame active window.
  assert.ok(Math.abs(pStart.limbAngle) < Math.abs(pEnd.limbAngle));
  assert.ok(pEnd.limbAngle > 0); // swings toward facing (positive for facing=1)
});

test('attack endlag window: pose recovers back toward neutral as frac advances', () => {
  // Jab: startup=3, active=2, endlag=8 (frames 5-12).
  const pStart = computePose(baseInput({ state: FighterStateId.ATTACK, moveId: MoveId.JAB, moveFrame: 5 }));
  const pMid = computePose(baseInput({ state: FighterStateId.ATTACK, moveId: MoveId.JAB, moveFrame: 8 }));
  const pEnd = computePose(baseInput({ state: FighterStateId.ATTACK, moveId: MoveId.JAB, moveFrame: 12 }));
  assert.ok(Math.abs(pStart.limbAngle) > Math.abs(pMid.limbAngle));
  assert.ok(Math.abs(pMid.limbAngle) > Math.abs(pEnd.limbAngle));
  // Recover asymptotically toward (but not necessarily reaching) zero.
  assert.ok(Math.abs(pEnd.limbAngle) < Math.abs(pStart.limbAngle) * 0.2);
});

test('attack pose facing flips the sign of lean/limb angle', () => {
  const right = computePose(baseInput({ state: FighterStateId.ATTACK, moveId: MoveId.JAB, moveFrame: 4, facing: 1 }));
  const left = computePose(baseInput({ state: FighterStateId.ATTACK, moveId: MoveId.JAB, moveFrame: 4, facing: -1 }));
  assert.ok(right.limbAngle > 0);
  assert.ok(left.limbAngle < 0);
  assert.equal(right.limbAngle, -left.limbAngle);
});

test('unknown moveId or out-of-range moveFrame falls back to neutral pose', () => {
  const badMove = computePose(baseInput({ state: FighterStateId.ATTACK, moveId: 999, moveFrame: 0 }));
  assert.deepEqual(badMove, NEUTRAL_POSE);
  const noMove = computePose(baseInput({ state: FighterStateId.ATTACK, moveId: -1, moveFrame: 0 }));
  assert.deepEqual(noMove, NEUTRAL_POSE);
  // Frame past the move's total duration (jab totals 3+2+8=13 frames).
  const pastEnd = computePose(baseInput({ state: FighterStateId.ATTACK, moveId: MoveId.JAB, moveFrame: 999 }));
  assert.deepEqual(pastEnd, NEUTRAL_POSE);
});

test('hitstun pose takes priority over the nominal state and decays as hitstun counts down', () => {
  // hitstun > 0 short-circuits computePose regardless of `state`.
  const inAttackButHitstun = computePose(
    baseInput({ state: FighterStateId.ATTACK, moveId: MoveId.JAB, moveFrame: 4, hitstun: 5 }),
  );
  const idleHitstun5 = computePose(baseInput({ state: FighterStateId.IDLE, hitstun: 5 }));
  assert.deepEqual(inAttackButHitstun, idleHitstun5);

  // As hitstun decays toward 0 the pose returns to whatever the state
  // produces (hitstun === 0 no longer short-circuits).
  const hitstunZero = computePose(baseInput({ state: FighterStateId.IDLE, stateTicks: 0, hitstun: 0 }));
  assert.deepEqual(hitstunZero, computePose(baseInput({ state: FighterStateId.IDLE, stateTicks: 0 })));
});

test('hitstun shake oscillates (not monotonic) as the hitstun counter runs down', () => {
  const shakes: number[] = [];
  for (let h = 60; h >= 1; h--) {
    shakes.push(computePose(baseInput({ state: FighterStateId.IDLE, hitstun: h, facing: 1 })).bodyLean);
  }
  const max = Math.max(...shakes);
  const min = Math.min(...shakes);
  assert.ok(max - min > anim.hitstunShake, 'expected the shake term to swing across a meaningful range');
});

test('dead pose falls further from neutral as ticks advance, clamped at ticks>=10', () => {
  const t0 = computePose(baseInput({ state: FighterStateId.DEAD, stateTicks: 0 }));
  const t5 = computePose(baseInput({ state: FighterStateId.DEAD, stateTicks: 5 }));
  const t10 = computePose(baseInput({ state: FighterStateId.DEAD, stateTicks: 10 }));
  const t20 = computePose(baseInput({ state: FighterStateId.DEAD, stateTicks: 20 }));
  assert.equal(t0.bodyLean, NEUTRAL_POSE.bodyLean);
  assert.equal(t0.bodyScaleY, NEUTRAL_POSE.bodyScaleY);
  assert.equal(t0.bodyScaleX, NEUTRAL_POSE.bodyScaleX);
  assert.ok(Math.abs(t0.bodyBob) < 1e-9);
  assert.ok(t5.bodyLean > t0.bodyLean);
  assert.ok(t10.bodyLean > t5.bodyLean);
  // Clamped: fall = min(1, ticks/10), so ticks=10 and ticks=20 are identical.
  assert.deepEqual(t10, t20);
});

test('airborne/jump tuck settles monotonically back to the neutral pose', () => {
  // JUMP and AIRBORNE share airbornePose(); tuck starts deep and decays
  // to 0 as stateTicks advances -- covered here since main's pass over
  // this file (issue #23) left JUMP/AIRBORNE unexercised, a gap PR #26
  // (ericseandevlin) surfaced.
  const start = computePose(baseInput({ state: FighterStateId.JUMP, stateTicks: 0 }));
  assert.ok(start.bodyScaleY < 1, 'tuck should compress bodyScaleY below neutral at takeoff');
  assert.ok(start.bodyBob > 0, 'tuck should lift bodyBob above neutral at takeoff');

  const scaleYs: number[] = [];
  for (let ticks = 0; ticks <= 12; ticks++) {
    scaleYs.push(computePose(baseInput({ state: FighterStateId.AIRBORNE, stateTicks: ticks })).bodyScaleY);
  }
  for (let i = 1; i < scaleYs.length; i++) {
    assert.ok(scaleYs[i]! > scaleYs[i - 1]!, `tuck must decay monotonically at tick ${i}`);
  }

  const settled = computePose(baseInput({ state: FighterStateId.JUMP, stateTicks: 12 }));
  assert.ok(Math.abs(settled.bodyScaleY - NEUTRAL_POSE.bodyScaleY) < 1e-9);
  assert.ok(Math.abs(settled.bodyBob - NEUTRAL_POSE.bodyBob) < 1e-9);
  assert.ok(Math.abs(settled.bodyLean - NEUTRAL_POSE.bodyLean) < 1e-9);
});
