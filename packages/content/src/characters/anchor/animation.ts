// Anchor's animation parameters: the slowest, heaviest presence in the
// cast -- deeper windup than even Ballast, minimal hitstun reaction (it
// barely notices being hit), a lumbering crawl of a run cycle.
import type { AnimationParams } from '../../animation/types.ts';

export const ANCHOR_ANIMATION: AnimationParams = {
  idleBreatheSpeed: 0.05,
  idleBreatheAmplitude: 0.018,

  runCycleSpeed: 0.55,
  runLimbSwing: 0.5,
  runBobAmplitude: 1.1, // heavy footfalls
  runLean: 0.09,

  windup: 1.2, // deepest wind-up in the cast -- unmistakably telegraphed
  swing: 1.7,
  attackTimingScale: 1.3,

  hitstunShake: 0.08, // barely flinches
};
