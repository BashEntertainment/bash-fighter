// Voltling's animation parameters: quick, twitchy, minimal anticipation
// -- a light glass-cannon reads as fast in motion the same way Ballast
// reads as heavy: exaggerated cycle speed and swing, not different frame
// counts (those stay the sim's alone).
import type { AnimationParams } from '../../animation/types.ts';

export const VOLTLING_ANIMATION: AnimationParams = {
  idleBreatheSpeed: 0.16, // quick, nervous
  idleBreatheAmplitude: 0.035,

  runCycleSpeed: 1.3, // brisk, skittering
  runLimbSwing: 1.1,
  runBobAmplitude: 0.9, // light on its feet -- barely bobs
  runLean: 0.08,

  windup: 0.3, // barely winds up -- strikes almost immediately
  swing: 1.25, // but the strike itself whips through hard
  attackTimingScale: 0.7,

  hitstunShake: 0.22, // flinches hard, easy to visibly rattle
};
