// Fixed top-level fighter states (Engine Architecture section 3), driven by
// the declarative transition table in state-machine/transitions.ts.
export const FighterStateId = {
  IDLE: 0,
  RUN: 1,
  JUMP: 2,
  AIRBORNE: 3,
  ATTACK: 4,
  HITSTUN: 5,
  SHIELD: 6,
  LEDGE: 7,
  DEAD: 8,
  // Non-interactive window between a KO and reappearing, used by
  // 'timedKO' respawns and non-final stock loss in 'stocks'/'battleRoyale'.
  // Distinct from DEAD, which is terminal elimination.
  RESPAWN: 9,
} as const;

export type FighterStateValue = (typeof FighterStateId)[keyof typeof FighterStateId];
