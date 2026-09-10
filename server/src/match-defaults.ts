// Single source of truth for production's default bot difficulty, shared
// between server/src/match.ts (the real match server) and the measurement
// harnesses under scripts/ (arena-shrink-metrics.mjs and friends).
//
// History: Task #28195 found every harness hardcoded BotDifficulty.HARD
// while claiming production defaulted to MEDIUM, and "corrected" the
// harnesses to MEDIUM based on an unverified assumption that the env var
// was unset in the deployed systemd unit. That assumption was wrong: on
// 2026-09-10 the live file /srv/bash-fighter/shared/bash-fighter.env was
// read directly and contains `MATCH_BOT_DIFFICULTY=easy`, confirmed by a
// new botDifficulty field added to the server's [matchEnd] production
// log line and read back via journalctl from real matches. Production
// runs EASY. This constant is now 'easy' to match reality.
//
// Structural fix so this cannot silently drift again: match.ts no
// longer lets a bare MATCH_BOT_DIFFICULTY env var override this
// constant (see botDifficultyFromEnv below) -- there is exactly one
// source of truth, here, used by the server and every harness. The env
// var is kept only as an explicit opt-in for deliberate experiments: it
// now requires MATCH_BOT_DIFFICULTY_ALLOW_OVERRIDE=1 set alongside it,
// so a stray env-file entry (like the 'easy' one that caused this
// correction) can never again quietly change production behaviour
// without someone deliberately flipping a second switch too.
export const PRODUCTION_DEFAULT_BOT_DIFFICULTY_NAME = 'easy';
