// Ballast's animation parameters: a heavyweight should look heavy in
// motion (Combat Model doc: 21% less knockback, longer startup/endlag on
// every move) without a single frame count changing here -- this file
// only exaggerates anticipation depth, run lean, and hitstun shake, all
// read against the sim's real frame windows by fighter-pose.ts.
import type { AnimationParams } from '../../animation/types.ts';

export const BALLAST_ANIMATION: AnimationParams = {
  idleBreatheSpeed: 0.05, // slower, heavier breathing
  idleBreatheAmplitude: 0.02,

  runCycleSpeed: 0.55, // lumbering, not brisk
  runLimbSwing: 0.5,
  runBobAmplitude: 2.2, // each step lands harder
  runLean: 0.22, // drives forward harder once moving

  windup: 0.85, // winds up further before swinging -- reads as heavy
  swing: 0.8, // but the swing itself is blunter, less whip
  attackTimingScale: 1.4,

  hitstunShake: 0.06, // harder to knock off its line -- less flinch
};
