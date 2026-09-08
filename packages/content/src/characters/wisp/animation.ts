// Wisp's animation parameters: skittish and evasive -- almost no
// wind-up (pokes out fast) and a light, darting run, reading as a
// fighter that never plans to stay in range.
import type { AnimationParams } from '../../animation/types.ts';

export const WISP_ANIMATION: AnimationParams = {
  idleBreatheSpeed: 0.2,
  idleBreatheAmplitude: 0.02,

  runCycleSpeed: 1.4,
  runLimbSwing: 0.6,
  runBobAmplitude: 0.5,
  runLean: 0.02,

  windup: 0.35, // fastest, most minimal wind-up in the cast
  swing: 1.3, // but a long, whipping extension on the active frame
  attackTimingScale: 0.8,

  hitstunShake: 0.35, // rattled easily -- it never plans to be caught
};
