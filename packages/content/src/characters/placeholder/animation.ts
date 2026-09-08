// Placeholder's animation parameters: brisk, light, neutral -- the
// baseline every other character's motion is judged against, same role
// as its neutral weight=100 in the knockback formula.
import type { AnimationParams } from '../../animation/types.ts';

export const PLACEHOLDER_ANIMATION: AnimationParams = {
  idleBreatheSpeed: 0.09,
  idleBreatheAmplitude: 0.03,

  runCycleSpeed: 0.9,
  runLimbSwing: 0.9,
  runBobAmplitude: 1.4,
  runLean: 0.12,

  windup: 0.5,
  swing: 1.0,
  attackTimingScale: 1.0,

  hitstunShake: 0.12,
};
