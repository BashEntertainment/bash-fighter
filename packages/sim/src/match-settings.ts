// Match configuration (this task's item 3, revised by owner decision
// 2026-09-07 15:14 PDT): the win condition is a per-match *setting*, not a
// hardcoded rule, and the respawn model is per-mode rather than global.
//
// - 'battleRoyale' (DEFAULT): single elimination, no respawn. Last fighter
//   standing wins. The arena shrinks (see arena-shrink.ts) as the field
//   thins, forcing survivors together instead of leaving most of a
//   20-player match idle-dead for most of its length.
// - 'timedKO': highest KO count within a time limit. Fighters respawn
//   (briefly invulnerable) after being KO'd instead of being eliminated.
// - 'stocks': classic fixed-lives elimination, no arena shrink by default.
//   Kept as the direct generalization of the original 2-fighter stock mode.
export type WinCondition = 'battleRoyale' | 'timedKO' | 'stocks';

export interface MatchSettings {
  winCondition: WinCondition;
  /** Stocks each fighter starts with. battleRoyale forces this to 1
   * (one life, no respawn) regardless of what is passed. */
  startingStocks: number;
  /** Only meaningful for 'timedKO': match ends at this tick count. */
  timeLimitTicks: number;
  /** Only meaningful for 'timedKO': fighters respawn after this many
   * ticks, with respawnInvulnTicks of invulnerability afterward. */
  respawnDelayTicks: number;
  respawnInvulnTicks: number;
  /** Whether the arena's blast-zone rectangle shrinks over the match (see
   * arena-shrink.ts). Defaults to true only for 'battleRoyale'. */
  arenaShrink: boolean;
  /** Tick count at which the tick-driven shrink component reaches full
   * closure (independent of how many fighters remain) — the "hazard storm
   * closing in" clock. */
  shrinkFullyClosedTick: number;
}

export const DEFAULT_MATCH_SETTINGS: MatchSettings = {
  winCondition: 'battleRoyale',
  startingStocks: 1,
  timeLimitTicks: 60 * 60 * 5, // 5 minutes, only used by 'timedKO'
  respawnDelayTicks: 90, // 1.5s
  respawnInvulnTicks: 60, // 1s
  arenaShrink: true,
  shrinkFullyClosedTick: 60 * 60 * 4, // 4 minutes
};

/** Fill in mode-appropriate defaults for any fields the caller omitted,
 * and enforce the mode/respawn/shrink coupling the owner specified: only
 * 'timedKO' respawns, only 'battleRoyale' shrinks by default, and
 * 'battleRoyale' is always single-stock. */
export function resolveMatchSettings(partial: Partial<MatchSettings> = {}): MatchSettings {
  const winCondition = partial.winCondition ?? DEFAULT_MATCH_SETTINGS.winCondition;
  const base: MatchSettings = {
    ...DEFAULT_MATCH_SETTINGS,
    winCondition,
    arenaShrink: partial.arenaShrink ?? winCondition === 'battleRoyale',
    startingStocks:
      partial.startingStocks ??
      (winCondition === 'battleRoyale' ? 1 : winCondition === 'stocks' ? 3 : 1),
  };
  const resolved: MatchSettings = { ...base, ...partial };
  if (winCondition === 'battleRoyale') resolved.startingStocks = 1;
  return resolved;
}

export function respawnsEnabled(settings: MatchSettings): boolean {
  return settings.winCondition === 'timedKO';
}
