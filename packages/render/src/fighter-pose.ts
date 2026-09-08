// Shared pose system: turns observed sim state into a silhouette
// deformation (lean/bob/scale/limb swing). Presentation only -- reads
// FighterStateId/moveId/moveFrame/hitstun exactly as the sim reports
// them and never writes anything back. Both existing characters
// (Placeholder, Ballast) go through this same function; only their
// AnimationParams (packages/content) and base silhouette shape differ.
//
// Attack alignment: `attackPose` uses the sim's own `findMove` and
// `windowAtFrame` (packages/sim/src/moves/types.ts) to find exactly
// which startup/active/endlag window `moveFrame` falls in, so the limb
// only reaches full extension during the window that is actually live
// for a hitbox -- never before, never after. If a character's frame
// data changes, this code does not need to: it reads the same table the
// sim executes against, so alignment can't drift out of sync.
import {
  FighterStateId,
  findMove,
  windowAtFrame,
  type CharacterData,
  type FighterStateValue,
} from '@bash-fighter/sim';
import type { AnimationParams } from '@bash-fighter/content';

export interface PoseInput {
  state: FighterStateValue;
  /** Ticks spent continuously in the current `state`, tracked by the
   *  caller (FighterSprite) purely for animation phase -- render-side
   *  bookkeeping, never read by or derived from the sim beyond noticing
   *  when `state` itself changes. */
  stateTicks: number;
  moveId: number; // -1 when not attacking
  moveFrame: number;
  hitstun: number;
  facing: 1 | -1;
  character: CharacterData;
  anim: AnimationParams;
}

export interface Pose {
  /** Radians, torso rotation. Positive leans toward +facing. */
  bodyLean: number;
  /** World units, + is up. */
  bodyBob: number;
  bodyScaleY: number;
  bodyScaleX: number;
  /** Radians, swing of the forward limb/nose off its resting angle. */
  limbAngle: number;
  /** 0..1+, how far the limb is extended along its swing. */
  limbExtend: number;
}

export const NEUTRAL_POSE: Pose = {
  bodyLean: 0,
  bodyBob: 0,
  bodyScaleY: 1,
  bodyScaleX: 1,
  limbAngle: 0,
  limbExtend: 0,
};

export function computePose(input: PoseInput): Pose {
  const { state, stateTicks, moveId, moveFrame, hitstun, facing, character, anim } = input;

  // Hitstun/knockback pose takes priority over whatever state the
  // fighter is nominally in -- a fighter can be HITSTUN while airborne,
  // and the stagger read matters more than the airborne pose there.
  if (hitstun > 0) return hitstunPose(hitstun, facing, anim);

  switch (state) {
    case FighterStateId.ATTACK:
      return attackPose(moveId, moveFrame, facing, character, anim);
    case FighterStateId.RUN:
      return runPose(stateTicks, anim);
    case FighterStateId.JUMP:
    case FighterStateId.AIRBORNE:
      return airbornePose(stateTicks, anim);
    case FighterStateId.IDLE:
      return idlePose(stateTicks, anim);
    case FighterStateId.DEAD:
      return deadPose(stateTicks);
    default:
      return NEUTRAL_POSE;
  }
}

function idlePose(ticks: number, anim: AnimationParams): Pose {
  const breathe = Math.sin(ticks * anim.idleBreatheSpeed) * anim.idleBreatheAmplitude;
  return {
    ...NEUTRAL_POSE,
    bodyScaleY: 1 + breathe,
    bodyScaleX: 1 - breathe * 0.5,
    bodyBob: breathe * 2,
  };
}

function runPose(ticks: number, anim: AnimationParams): Pose {
  const t = ticks * anim.runCycleSpeed;
  const swing = Math.sin(t);
  return {
    ...NEUTRAL_POSE,
    bodyBob: Math.abs(Math.cos(t)) * anim.runBobAmplitude,
    bodyLean: anim.runLean,
    limbAngle: swing * anim.runLimbSwing,
    limbExtend: 0.6,
  };
}

function airbornePose(ticks: number, anim: AnimationParams): Pose {
  // Tuck on jump entry, settling back toward neutral over ~12 ticks --
  // we don't have vertical velocity here, just "how long have we been
  // airborne", which is enough for a legible jump read without the pose
  // needing to know anything the sim state machine doesn't already
  // expose via the state+ticks pair.
  const tuck = Math.max(0, 1 - ticks / 12);
  return {
    ...NEUTRAL_POSE,
    bodyScaleY: 1 - 0.12 * tuck,
    bodyScaleX: 1 + 0.08 * tuck,
    limbAngle: -0.3 * tuck,
    limbExtend: 0.3 * tuck,
    bodyBob: 1.5 * tuck * (anim.runBobAmplitude > 0 ? 1 : 1),
  };
}

function hitstunPose(hitstun: number, facing: 1 | -1, anim: AnimationParams): Pose {
  const shake = Math.sin(hitstun * 2.3) * anim.hitstunShake;
  return {
    ...NEUTRAL_POSE,
    bodyLean: -facing * 0.35 + shake,
    bodyScaleY: 0.9,
    bodyScaleX: 1.1,
    limbAngle: -facing * 0.8,
    limbExtend: 0.4,
  };
}

function deadPose(ticks: number): Pose {
  const fall = Math.min(1, ticks / 10);
  return {
    ...NEUTRAL_POSE,
    bodyLean: fall * 1.4,
    bodyScaleY: 1 - 0.3 * fall,
    bodyScaleX: 1 + 0.2 * fall,
    bodyBob: -fall * 3,
  };
}

function attackPose(
  moveId: number,
  moveFrame: number,
  facing: 1 | -1,
  character: CharacterData,
  anim: AnimationParams,
): Pose {
  if (moveId < 0) return NEUTRAL_POSE;
  const move = findMove(character, moveId as never);
  if (!move) return NEUTRAL_POSE;
  const found = windowAtFrame(move, moveFrame);
  if (!found) return NEUTRAL_POSE;
  const { window, frameInWindow } = found;
  const frac = window.duration > 1 ? frameInWindow / (window.duration - 1) : 1;

  if (window.kind === 'startup') {
    // Anticipation: cock back away from the swing direction, growing
    // with frac. `attackTimingScale` makes this deeper (not longer --
    // duration is the sim's frame count) for heavier characters.
    const depth = anim.windup * anim.attackTimingScale * frac;
    return {
      ...NEUTRAL_POSE,
      bodyLean: -facing * depth,
      limbAngle: -facing * depth,
      limbExtend: 0.15,
      bodyScaleX: 1 + 0.05 * frac,
    };
  }
  if (window.kind === 'active') {
    // The live hitbox window: the limb sweeps through to full extension
    // across exactly this window, so contact happens while the limb is
    // visibly out, not before or after.
    const reach = 0.3 + 0.7 * frac;
    return {
      ...NEUTRAL_POSE,
      bodyLean: facing * anim.swing * reach,
      limbAngle: facing * anim.swing * reach,
      limbExtend: 1,
      bodyScaleX: 0.95,
    };
  }
  // endlag: recover back toward neutral as frac advances.
  const recover = 1 - frac;
  return {
    ...NEUTRAL_POSE,
    bodyLean: facing * anim.swing * recover * 0.5,
    limbAngle: facing * anim.swing * recover * 0.5,
    limbExtend: recover,
  };
}
