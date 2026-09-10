// Single source of truth for production's default bot difficulty, shared
// between server/src/match.ts (the real match server) and the measurement
// harnesses under scripts/ (arena-shrink-metrics.mjs and friends). Task
// #28195 found that every harness had hardcoded BotDifficulty.HARD while
// production actually defaults to MEDIUM (MATCH_BOT_DIFFICULTY env var,
// unset in the deployed systemd unit) -- so months of wiki-recorded
// combat-share/duration measurements described a harder, more combative
// lobby than real players get. Importing this one constant into both
// sides means the two can never silently drift apart again: change the
// production default here and every harness picks it up automatically.
export const PRODUCTION_DEFAULT_BOT_DIFFICULTY_NAME = 'medium';
