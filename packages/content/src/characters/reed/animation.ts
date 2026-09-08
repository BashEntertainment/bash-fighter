// Reed's animation parameters: a controlled, patient zoner -- slow to
// wind up and slow to swing back down relative to the placeholder,
// reading as "measuring distance" rather than "committing" the way
// Ballast's heavy lean or Voltling's twitchy skitter do.
import type { AnimationParams } from '../../animation/types.ts';

export const REED_ANIMATION: AnimationParams = {
  idleBreatheSpeed: 0.09, // slow, steady -- patient
  idleBreatheAmplitude: 0.025,

  runCycleSpeed: 0.85, // measured stride, not a scramble
  runLimbSwing: 0.7,
  runBobAmplitude: 0.6, // upright, minimal bob -- keeps its reach level
  runLean: 0.04, // barely leans -- stays poised to poke rather than close distance

  windup: 0.85, // telegraphs the poke -- a long, visible cock-back before the reach
  swing: 1.5, // then extends far -- the long disjointed limb reading as a genuine reach
  attackTimingScale: 1.0,

  hitstunShake: 0.15, // composed even when hit -- doesn't rattle as hard as Voltling
};
