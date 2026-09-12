// Server-side mode rotation (2026-09-11, Timed Brawl launch): decides,
// per created match (not per connection -- a match's mode must be fixed
// for every seat that joins it), whether that match runs Timed Brawl or
// stays on the Last Fighter Standing (battleRoyale) default.
//
// Deliberately a single small pure function, unit-testable without a
// server or a websocket: given a 1-based match sequence number, cadence,
// and disabled flag, it returns the mode -- no side effects, no clock.
// RoomManager calls this once per fresh match and logs the result; Match
// just receives the already-decided mode.
import type { WinCondition } from '@bash-fighter/sim/src/index.ts';

/** Every Nth match created runs Timed Brawl; the rest run the Battle
 *  Royale default. Configurable so ops can change the split without a
 *  redeploy. Must be >= 1 (a value of 1 would make every match Timed
 *  Brawl -- allowed, but the default keeps Battle Royale the headline
 *  experience at a 2-in-3 majority). */
export const MODE_ROTATION_CADENCE = Math.max(1, Number(process.env.MATCH_MODE_ROTATION_CADENCE ?? 3));

/** Kill switch: set truthy to disable rotation entirely and pin
 *  production to the pre-rotation behaviour (every match uses the
 *  existing MATCH_WIN_CONDITION override, or battleRoyale if that is
 *  also unset). For an emergency rollback without touching code. */
export const MODE_ROTATION_DISABLED = /^(1|true|yes)$/i.test(process.env.MATCH_MODE_ROTATION_DISABLED ?? '');

/** Timed Brawl's match length in the rotation. Chosen at 3 minutes
 *  (10800 ticks @ 60Hz): production Battle Royale matches resolve in
 *  60-90s (docs/MEASUREMENT.md, median 84.4s), so Timed Brawl needs to
 *  run noticeably longer than that to read as a distinct mode rather
 *  than "the same match but with a clock" -- but the sim's own default
 *  of 5 minutes (packages/sim/src/match-settings.ts) is too long for a
 *  bot-filled casual drop-in lobby where the median player did not
 *  choose this mode. 3 minutes matches the plain-language line shown to
 *  players ("most knockouts in 3 minutes wins") and is a round, legible
 *  number distinct from both the sim default and Battle Royale's
 *  natural length. */
export const TIMED_BRAWL_TIME_LIMIT_TICKS = 60 * 60 * 3;

export interface ModeDecision {
  winCondition: WinCondition;
  /** Only set when winCondition is 'timedKO'; undefined otherwise so
   *  callers don't accidentally apply a time limit to battleRoyale. */
  timeLimitTicks?: number;
}

/** Pure decision function: given the 1-based sequence number of the match
 *  being created (RoomManager's nextId at creation time, before
 *  increment), returns which mode it should run. Deterministic: the same
 *  (matchNumber, cadence, disabled) always returns the same answer, so
 *  this is testable without any timers or randomness, and the split is
 *  exactly "1 in cadence", not merely probabilistic. */
export function decideMatchMode(
  matchNumber: number,
  cadence: number = MODE_ROTATION_CADENCE,
  disabled: boolean = MODE_ROTATION_DISABLED,
): ModeDecision {
  if (!disabled && matchNumber % cadence === 0) {
    return { winCondition: 'timedKO', timeLimitTicks: TIMED_BRAWL_TIME_LIMIT_TICKS };
  }
  return { winCondition: 'battleRoyale' };
}

/** Plain-language line shown to players before the match starts (lobby
 *  screen) -- see index item 2: never show the internal identifier
 *  ('timedKO') to a player. Battle Royale is the headline default and
 *  gets a short label; Timed Brawl states its win condition and length
 *  in words a new player understands, matching the format the owner
 *  specified. */
export function modeDisplayName(winCondition: WinCondition, timeLimitTicks?: number): string {
  if (winCondition === 'timedKO') {
    const minutes = Math.round((timeLimitTicks ?? TIMED_BRAWL_TIME_LIMIT_TICKS) / 60 / 60);
    return `Timed Brawl — most knockouts in ${minutes} minutes wins`;
  }
  if (winCondition === 'stocks') return 'Stocks';
  return 'Battle Royale — last fighter standing wins';
}
