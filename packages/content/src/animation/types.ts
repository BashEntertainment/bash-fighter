// Per-character animation parameters (Engine Architecture part 2 section 7
// pattern: presentation data lives next to the character it describes,
// same as CharacterData). These never touch the sim -- packages/render
// reads them purely to decide how a fighter's silhouette moves; changing
// a number here can never change a hitbox, a frame count, or a knockback
// value. See packages/render/src/fighter-pose.ts for the consumer.
//
// Units: angles are in radians already (not degrees) so the pose module
// never has to convert; amplitudes/speeds are tuned by eye against the
// real active-frame windows, not derived from a formula.
export interface AnimationParams {
  /** Idle breathing: sin(tick * speed) drives a subtle scale pulse. */
  idleBreatheSpeed: number;
  idleBreatheAmplitude: number;

  /** Run cycle: sin/cos(tick * speed) drives limb swing + a bob. */
  runCycleSpeed: number;
  runLimbSwing: number;
  runBobAmplitude: number;
  /** Constant forward lean while running -- heavier characters lean less
   *  (they don't get thrown forward as easily) but drive through harder. */
  runLean: number;

  /** Attack anticipation/swing. `windup` is how far the limb/torso cocks
   *  back during the startup window (radians); `swing` is how far it
   *  sweeps forward during the active window. `attackTimingScale`
   *  exaggerates windup depth (not duration -- durations are the sim's
   *  frame counts and are never touched here) for heavier characters. */
  windup: number;
  swing: number;
  attackTimingScale: number;

  /** Hitstun stagger shake amplitude. */
  hitstunShake: number;
}
