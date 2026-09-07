// Fixed top-level fighter states (Engine Architecture §3). Only idle/run/
// jump/airborne are reachable by this minimal loop; attack/hitstun/shield/
// ledge/dead exist as named states for future work but are unused for now.
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
} as const;

export type FighterStateValue = (typeof FighterStateId)[keyof typeof FighterStateId];
