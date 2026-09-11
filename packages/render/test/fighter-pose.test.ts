// Unit tests for packages/render/src/fighter-pose.ts (computePose) --
// addresses issue #23: the shared pose computation used by every
// character's render shape had zero automated tests. computePose is pure
// computation over numbers (sim state in, pose parameters out), so these
// tests run with no Pixi/DOM/WebGL involvement and use the placeholder
// character's real frame data (packages/content) as input, exactly the
// way FighterSprite feeds it at runtime.
//
// Placeholder's Jab is the attack used throughout: startup 3 frames,
// active 2, endlag 8 -- see packages/content/src/characters/placeholder/data.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computePose, NEUTRAL_POSE, type PoseInput } from '../src/fighter-pose.ts';
import { FighterStateId, MoveId } from '@bash-fighter/sim';
import { PLACEHOLDER_CHARACTER, PLACEHOLDER_ANIMATION } from '@bash-fighter/content';

const anim = PLACEHOLDER_ANIMATION;
const character = PLACEHOLDER_CHARACTER;

/** A valid PoseInput with sensible defaults; overrides per test. */
function input(overrides: Partial<PoseInput> = {}): PoseInput {
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

test('idle at tick 0 is exactly the neutral pose', () => {
  // sin(0) = 0, so the breathing pulse contributes nothing.
  assert.deepEqual(computePose(input()), NEUTRAL_POSE);
});

test('idle pose oscillates within its tuned amplitude and never drifts', () => {
  const amp = anim.idleBreatheAmplitude;
  for (let ticks = 0; ticks < 200; ticks++) {
    const pose = computePose(input({ stateTicks: ticks }));
    assert.ok(Math.abs(pose.bodyScaleY - 1) <= amp + 1e-9, `bodyScaleY out of band at tick ${ticks}`);
    assert.ok(Math.abs(pose.bodyScaleX - 1) <= amp * 0.5 + 1e-9, `bodyScaleX out of band at tick ${ticks}`);
    assert.ok(Math.abs(pose.bodyBob) <= amp * 2 + 1e-9, `bodyBob out of band at tick ${ticks}`);
    assert.equal(pose.bodyLean, 0);
  }
});

test('run cycle is periodic, not monotonic: swing rises and falls', () => {
  const angles: number[] = [];
  for (let ticks = 0; ticks < 60; ticks++) {
    angles.push(computePose(input({ state: FighterStateId.RUN, stateTicks: ticks })).limbAngle);
  }
  let rises = 0;
  let falls = 0;
  for (let i = 1; i < angles.length; i++) {
    if (angles[i]! > angles[i - 1]!) rises++;
    if (angles[i]! < angles[i - 1]!) falls++;
  }
  assert.ok(rises > 0 && falls > 0, 'run limb swing should oscillate both ways');
  // Whole cycle stays inside the tuned swing amplitude.
  for (const a of angles) assert.ok(Math.abs(a!) <= anim.runLimbSwing + 1e-9);
});

test('run pose leans forward constantly and bobs non-negative within amplitude', () => {
  for (let ticks = 0; ticks < 40; ticks++) {
    const pose = computePose(input({ state: FighterStateId.RUN, stateTicks: ticks }));
    assert.equal(pose.bodyLean, anim.runLean);
    assert.ok(pose.bodyBob >= 0 && pose.bodyBob <= anim.runBobAmplitude + 1e-9);
    assert.equal(pose.limbExtend, 0.6);
  }
});

test('attack with no move id falls back to neutral', () => {
  assert.deepEqual(
    computePose(input({ state: FighterStateId.ATTACK, moveId: -1 })),
    NEUTRAL_POSE,
  );
});

test('attack startup: windup grows with frac and the limb stays unextended', () => {
  // Jab startup window is 3 frames -> frac = 0, 0.5, 1.
  const leans: number[] = [];
  for (let frame = 0; frame < 3; frame++) {
    const pose = computePose(
      input({ state: FighterStateId.ATTACK, moveId: MoveId.JAB, moveFrame: frame }),
    );
    // Cocking back away from +facing: negative lean, growing in magnitude.
    assert.ok(pose.bodyLean <= 0, `startup lean should be negative at frame ${frame}`);
    assert.equal(pose.limbExtend, 0.15);
    leans.push(Math.abs(pose.bodyLean));
  }
  for (let i = 1; i < leans.length; i++) {
    assert.ok(leans[i]! > leans[i - 1]!, 'windup depth must grow through the startup window');
  }
  // Full windup equals windup * attackTimingScale * frac(=1).
  assert.equal(leans[2], anim.windup * anim.attackTimingScale);
});

test('attack active: limb reaches full extension and sweeps forward', () => {
  // Jab active window is 2 frames -> reach 0.3 then 1.0.
  const frame3 = computePose(
    input({ state: FighterStateId.ATTACK, moveId: MoveId.JAB, moveFrame: 3 }),
  );
  const frame4 = computePose(
    input({ state: FighterStateId.ATTACK, moveId: MoveId.JAB, moveFrame: 4 }),
  );
  assert.equal(frame3.limbExtend, 1);
  assert.equal(frame4.limbExtend, 1);
  assert.ok(frame4.bodyLean > frame3.bodyLean, 'swing must sweep forward through the window');
  assert.equal(frame4.bodyLean, anim.swing);
  assert.equal(frame4.limbAngle, anim.swing);
});

test('attack endlag: recover decays back to exactly neutral', () => {
  // Jab endlag is 8 frames (frames 5..12) -> recover = 1 .. 0.
  const frame5 = computePose(
    input({ state: FighterStateId.ATTACK, moveId: MoveId.JAB, moveFrame: 5 }),
  );
  assert.equal(frame5.limbExtend, 1);
  assert.ok(frame5.bodyLean > 0);
  for (let frame = 6; frame <= 12; frame++) {
    const pose = computePose(
      input({ state: FighterStateId.ATTACK, moveId: MoveId.JAB, moveFrame: frame }),
    );
    assert.ok(pose.limbExtend >= 0 && pose.limbExtend < 1, `endlag recover out of range at frame ${frame}`);
  }
  // Last endlag frame: recover = 0 -> indistinguishable from neutral.
  assert.deepEqual(
    computePose(input({ state: FighterStateId.ATTACK, moveId: MoveId.JAB, moveFrame: 12 })),
    NEUTRAL_POSE,
  );
});

test('attack frame beyond the move table returns neutral', () => {
  assert.deepEqual(
    computePose(input({ state: FighterStateId.ATTACK, moveId: MoveId.JAB, moveFrame: 999 })),
    NEUTRAL_POSE,
  );
});

test('hitstun pose is a bounded oscillation around the stagger lean, never a growing offset', () => {
  const amp = anim.hitstunShake;
  for (let hitstun = 1; hitstun <= 40; hitstun++) {
    const pose = computePose(input({ hitstun }));
    assert.equal(pose.bodyScaleY, 0.9);
    assert.equal(pose.bodyScaleX, 1.1);
    const deviation = Math.abs(pose.bodyLean - -0.35); // stagger base for facing = 1
    assert.ok(deviation <= amp + 1e-9, `shake exceeded amplitude at hitstun ${hitstun}`);
    assert.equal(pose.limbAngle, -0.8);
  }
});

test('hitstun mirrors with facing and overrides any nominal state', () => {
  const left = computePose(input({ hitstun: 3, facing: -1 }));
  const right = computePose(input({ hitstun: 3, facing: 1 }));
  assert.equal(Math.sign(left.limbAngle), -Math.sign(right.limbAngle));
  // Even mid-attack, hitstun wins.
  const midAttack = computePose(
    input({ state: FighterStateId.ATTACK, moveId: MoveId.JAB, moveFrame: 4, hitstun: 3 }),
  );
  assert.equal(midAttack.bodyScaleY, 0.9);
});

test('dead pose falls monotonically to its final resting pose', () => {
  const frame0 = computePose(input({ state: FighterStateId.DEAD, stateTicks: 0 }));
  // fall = 0 here, but bodyBob computes to -0, which is !== 0 under strict
  // equality (Object.is semantics in both Bun and Node), so magnitude checks
  // pin these to neutral without tripping on zero's sign.
  assert.equal(frame0.bodyLean, 0);
  assert.ok(Math.abs(frame0.bodyBob) === 0);
  assert.equal(frame0.bodyScaleY, 1);
  assert.equal(frame0.bodyScaleX, 1);
  for (let ticks = 1; ticks <= 20; ticks++) {
    const pose = computePose(input({ state: FighterStateId.DEAD, stateTicks: ticks }));
    assert.ok(pose.bodyLean > 0, 'dead lean must progress forward once falling starts');
    assert.ok(pose.bodyBob <= 0);
  }
  const settled = computePose(input({ state: FighterStateId.DEAD, stateTicks: 10 }));
  assert.equal(settled.bodyLean, 1.4);
  assert.equal(settled.bodyBob, -3);
});

test('airborne tuck settles back to exactly neutral within 12 ticks', () => {
  const tuck0 = computePose(input({ state: FighterStateId.JUMP }));
  assert.equal(tuck0.bodyScaleY, 1 - 0.12);
  assert.equal(tuck0.bodyBob, 1.5);
  const scales: number[] = [];
  for (let ticks = 0; ticks <= 12; ticks++) {
    scales.push(computePose(input({ state: FighterStateId.AIRBORNE, stateTicks: ticks })).bodyScaleY);
  }
  for (let i = 1; i < scales.length; i++) {
    assert.ok(scales[i]! > scales[i - 1]!, 'airborne tuck must decay monotonically');
  }
  // tick 12: tuck = 0 exactly, and limbAngle computes to -0, so pin each
  // field to neutral with == rather than deepEqual.
  const settled = computePose(input({ state: FighterStateId.JUMP, stateTicks: 12 }));
  assert.equal(settled.bodyLean, 0);
  assert.ok(Math.abs(settled.bodyBob) === 0);
  assert.equal(settled.bodyScaleY, 1);
  assert.equal(settled.bodyScaleX, 1);
  assert.ok(Math.abs(settled.limbAngle) === 0); // limbAngle computes to -0 here
  assert.equal(settled.limbExtend, 0);
});