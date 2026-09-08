// Zephyr's animation parameters: light, springy, always slightly
// airborne-feeling -- quick low-amplitude idle, a bouncing run, and fast
// snapping aerial swings that read as mid-flip rather than a plant-your-
// feet swing.
import type { AnimationParams } from '../../animation/types.ts';

export const ZEPHYR_ANIMATION: AnimationParams = {
  idleBreatheSpeed: 0.14,
  idleBreatheAmplitude: 0.035,

  runCycleSpeed: 1.15,
  runLimbSwing: 0.8,
  runBobAmplitude: 1.3, // pronounced bouncy bob -- always look ready to jump
  runLean: 0.03, // upright, coiled rather than driving forward

  windup: 0.5,
  swing: 1.15,
  attackTimingScale: 0.85,

  hitstunShake: 0.22,
};
