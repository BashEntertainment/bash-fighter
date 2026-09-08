// Scrapper's animation parameters: quick, aggressive, always advancing --
// the fastest windup/swing return-to-neutral in the cast, matching its
// fastest-startup/endlag moveset. Reads as itching to close distance.
import type { AnimationParams } from '../../animation/types.ts';

export const SCRAPPER_ANIMATION: AnimationParams = {
  idleBreatheSpeed: 0.16,
  idleBreatheAmplitude: 0.03,

  runCycleSpeed: 1.3,
  runLimbSwing: 0.9,
  runBobAmplitude: 0.9,
  runLean: 0.12, // leans hard into a forward charge

  windup: 0.4, // barely any wind-up -- throws hits out almost instantly
  swing: 1.0,
  attackTimingScale: 0.9,

  hitstunShake: 0.3, // shrugs off hitstun quickly, itching to swing back
};
