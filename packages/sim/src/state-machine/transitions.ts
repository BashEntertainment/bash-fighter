// Declarative fighter state machine (Engine Architecture section 3):
// idle, run, jump, airborne, attack, hitstun, shield, ledge, dead. Rather
// than scattering `if` chains through the tick loop, every legal edge is
// listed here once; sim.ts calls assertTransition() whenever it moves a
// fighter between states, so an illegal edge is a thrown bug, not a silent
// state corruption.
import { FighterStateId, type FighterStateValue } from '../entities/fighter.ts';

const {
  IDLE, RUN, JUMP, AIRBORNE, ATTACK, HITSTUN, SHIELD, LEDGE, DEAD, RESPAWN,
} = FighterStateId;

/** Allowed destination states for each source state. DEAD has no outgoing
 * edges: a fighter only leaves DEAD via an explicit respawn reset, which
 * bypasses the transition table entirely (it is a new life, not a move).
 * RESPAWN is reachable from any state that can be interrupted by a KO
 * (mirroring the existing -> DEAD edges) and leaves only to IDLE, when the
 * respawn timer elapses. */
export const TRANSITIONS: Readonly<Record<FighterStateValue, ReadonlySet<FighterStateValue>>> = {
  [IDLE]: new Set([IDLE, RUN, JUMP, AIRBORNE, ATTACK, HITSTUN, SHIELD, LEDGE, DEAD, RESPAWN]),
  [RUN]: new Set([IDLE, RUN, JUMP, AIRBORNE, ATTACK, HITSTUN, SHIELD, DEAD, RESPAWN]),
  [JUMP]: new Set([AIRBORNE, HITSTUN, DEAD, RESPAWN]),
  [AIRBORNE]: new Set([IDLE, RUN, AIRBORNE, ATTACK, HITSTUN, LEDGE, DEAD, RESPAWN]),
  [ATTACK]: new Set([IDLE, RUN, AIRBORNE, ATTACK, HITSTUN, DEAD, RESPAWN]),
  [HITSTUN]: new Set([IDLE, RUN, AIRBORNE, HITSTUN, DEAD, RESPAWN]),
  [SHIELD]: new Set([IDLE, HITSTUN, DEAD, RESPAWN]),
  [LEDGE]: new Set([IDLE, AIRBORNE, HITSTUN, DEAD, RESPAWN]),
  [RESPAWN]: new Set([RESPAWN, IDLE, DEAD]),
  [DEAD]: new Set([]),
};

export function canTransition(from: FighterStateValue, to: FighterStateValue): boolean {
  if (from === to) return true;
  return TRANSITIONS[from].has(to);
}

/** Throw if `from -> to` is not a listed edge. Called on every state write
 * in sim.ts so an ad-hoc/incorrect transition fails loudly instead of
 * silently corrupting a replay. */
export function assertTransition(from: FighterStateValue, to: FighterStateValue): void {
  if (!canTransition(from, to)) {
    throw new Error(`illegal fighter state transition: ${from} -> ${to}`);
  }
}
