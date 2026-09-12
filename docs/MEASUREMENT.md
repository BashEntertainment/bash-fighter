# Match measurement: what the offline harness can and cannot tell you

## The problem (issue #31)

Every offline measurement harness we had before `scripts/human-analog-metrics.mjs`
(`full-sweep-metrics.mjs`, `bot-brawl-metrics.mjs`, `human-placement-metrics.mjs`,
etc.) runs matches with **zero human seats** — 20 bots, or 19 bots plus one
*passive or scripted* stand-in. Every production match has at least one real
human. That difference has repeatedly produced numbers that did not hold up:
most notoriously a 93% "timeout" rate (Task 28163) that never occurs live, and
elimination-cause splits that disagreed with production logs.

**Rule: production server logs are ground truth. Any offline harness result
that disagrees with them is wrong until proven otherwise, not the other way
around.** This doc exists so nobody has to re-litigate that when the next
harness produces a surprising number.

## The harness: `scripts/human-analog-metrics.mjs`

Runs many matches offline using `createMatchSim` (the one sanctioned Sim
builder — same items, hazard config, and arena resolution as production).
One seat (slot 0) is driven by a **human-analog controller**, distinct from
the tuned-for-competence `BotController`:

| parameter | default | meaning |
|---|---|---|
| `reactionTicks` | 10 (~166ms) | ticks between decisions; input is held between decisions instead of re-evaluated every tick |
| `aimJitter` | 0.35 | chance a decision picks a random direction instead of "toward nearest opponent" |
| `idleProb` | 0.10 | chance a decision window does nothing at all |
| `attackProb` | 0.12 | chance of throwing an attack in an active decision window |

**These numbers are not fit to any real human input data — there is none
available to fit to.** They are a deliberately-worse-than-BotController
approximation, chosen to be "clearly worse on every axis" rather than
calibrated to a measured population. Treat every absolute number this
harness prints as an approximation gated by that fact, and lean on the
comparison table below, not on the numbers alone, to judge whether the
approximation is even in the right neighborhood.

Run it with:
```
node --experimental-strip-types scripts/human-analog-metrics.mjs [trials] [difficulty] [ceilingTicks] [--reactionTicks=N] [--aimJitter=F] [--idleProb=F] [--attackProb=F]
```

It reports, per run and aggregated: match duration, the human-analog seat's
placement distribution, time-to-first-elimination (any fighter), the human
seat's own elimination time, the elimination-cause split (`fall` /
`knockout` / `ring` / `ring_lethal`, read directly off `Sim.eliminationEvents`
— the same truthful attribution production's own elimination log line
uses), and the percent-at-death distribution.

A ceiling note, inherited from `full-sweep-metrics.mjs`'s own warning: the
ceiling must clear `shrinkFullyClosedTick` (28800 ticks in
`DEFAULT_MATCH_SETTINGS`) plus the ~2-minute stalemate-override relax
window, or the harness will read almost every match as a false "timeout" —
an artifact of the harness's own ceiling, not the game. Verified directly:
at `ceilingTicks=28920` this harness saw ~100% timeouts; the default
`36000` resolves normally. If you lower the ceiling, expect the timeout
rate to become meaningless again.

## Harness vs. production, measured 2026-09-11

Production data: `ssh root@135.181.45.254 "journalctl -u bash-fighter --since
'-6h' --no-pager"`, 8 completed matches, 133 elimination events (percentAtDeath
is stored as fixed-point in the raw log — divide by 65536 — the numbers below
are already converted), 8 human-seat eliminations.

Harness data: `node --experimental-strip-types scripts/human-analog-metrics.mjs 8 easy` and
`... 8 hard` (production's bots run EASY — see wiki "Bot Difficulty
Correction" — HARD run for comparison), default parameters, `ceilingTicks=36000`.

| metric | production (8 matches) | harness EASY (8 trials) | harness HARD (8 trials) |
|---|---|---|---|
| match duration | 40.4–122.9s, median 84.4s | 503.6–533.2s, median 513.9s | 489.9–595.9s, median 535.5s |
| human seat eliminated at | 25.5–58.4s, median 50.5s | 493.7–528.3s, median 508.6s | 483.2–554.3s, median 512.1s |
| human seat placement | 5,5,6,8,13,13,13,15 (median 10.5 of 20) | median 6, mean 6.9 | median 7.5 |
| elimination cause split | knockout 72.2%, ring 18.0%, fall 9.8%, ring_lethal 0% | knockout 0%, ring 98%, fall 2%, ring_lethal 0% | knockout 0%, ring 96.7%, fall 3.3%, ring_lethal 0% |
| percent-at-death | min 3.0, median 106.4, max 205.4 | min 0, p25 0, median 10, p75 18, max 78.7 | min 0, median 7, p75 14.6, max 58.5 |

## Root cause found and fixed, 2026-09-11

**The gap was a harness defect, not a sim/bot-AI defect, and it is now fixed.**

Every offline harness that measured this gap -- `human-analog-metrics.mjs`
(above) and the pre-existing `full-sweep-metrics.mjs` -- built its `Sim`
by calling `createMatchSim(seed, N, {}, undefined, arenaId)` /
`new Sim(seed, N, undefined, ...)`, i.e. passing `undefined` for the
per-seat `characters` argument. `packages/sim/src/sim.ts` resolves a
missing `characters` argument to its own internal `DEFAULT_CHARACTER`
for every seat:

```
const DEFAULT_CHARACTER: CharacterData = {
  name: 'Unnamed', weight: fx.fromInt(100),
  hurtboxWidth: fx.fromFloat(1.6), hurtboxHeight: fx.fromFloat(3.2),
  moves: [],   // <-- no moves at all
};
```

`moves: []` is deliberate at the sim-core level -- it lets a unit test
that only cares about movement/physics build a `Sim` without pulling in
`packages/content`'s character data (see that constant's own comment:
"attack input is simply a no-op"). But every offline metrics harness
used it as if it were a neutral stand-in for "some fighter," including
`full-sweep-metrics.mjs`'s own comment claiming uniform
`DEFAULT_CHARACTER` "stays comparable with prior measurements." It is
not neutral: **every bot in every offline sweep was, and had always
been, physically incapable of landing a single attack**, at any
difficulty, on any arena, no matter how the AI's targeting/reaction/
attack-range tuning was adjusted in the many passes chasing this
("Bot Combat Engagement Fix," the ring-pressure redesign, the
hesitation dampener, etc. -- see the linked pages below). Production
never has this problem: `server/src/match.ts` always resolves real
character data per seat via `resolveCharacterId`, and
`server/src/rooms.ts`'s bot-fill timer gives every bot seat a real,
deterministically-drawn character from `ALL_CHARACTERS` (never the
sim-core stub).

**Proof.** Re-ran a pure 20-bot, no-human, `MATCH_BOT_DIFFICULTY=easy`
match through `createMatchSim` twice, identical in every way except the
`characters` argument:

| characters passed | duration | knockout | ring | fall |
|---|---|---|---|---|
| `undefined` (the old bug) | ~502-515s (2 seeds) | 0% | 100% | 0% |
| real roster, drawn the same way `server/src/rooms.ts` draws it | 60.7-97.3s (4 seeds) | 68-79% | 13-25% | 0-8% |

Same seed, same arena, same bot difficulty, same everything else --
flipping only the `characters` argument took the offline harness from
"bots can never fight" to numbers in the same neighborhood as
production. This is conclusive, not circumstantial: it is a single
before/after with everything else held constant, not a correlation.

**Hypotheses tested and killed before finding this:**
- *Bot difficulty mismatch* -- killed. `server/src/match-defaults.ts`
  and the live `/srv/bash-fighter/shared/bash-fighter.env` both confirm
  production runs EASY with no override; both harnesses already used
  EASY as their default and the bug reproduced at every difficulty in
  `full-sweep-metrics.mjs`'s own sweep.
- *Tick rate / input cadence mismatch* -- killed. `server/src/match.ts`'s
  `tickOnce()` calls `bot.nextInput(sim)` once per bot, once per
  `sim.advance()` call, at `TICK_HZ = 60`, exactly like both harnesses'
  `for (t=0; t<CEIL; t++) { ...; sim.advance(inputs) }` loops. Read side
  by side; no discrepancy.
- *Different arena distribution offline* -- killed. Both use
  `pickArenaId(seed)` / the real arena roster; a live production
  `matchSummary` line and an offline run land on the same arenas
  (`battle-royale-20`, `the-atoll`, etc.).
- *Deploy lag (server running older code than `main`)* -- killed.
  `/srv/bash-fighter/current` is a symlink to
  `releases/20260911222819-b1f9c62`, and `git rev-parse HEAD` on `main`
  in this checkout is also `b1f9c62`. Identical commit.
- *Presence of a human seat changing bot dynamics* -- killed as the
  primary driver, though it remains a secondary, smaller effect. Real
  production log evidence: matchId `m1` recurred verbatim (same seed,
  since `seedFromMatchId` is deterministic) across two separate server
  restarts on 2026-09-11. The **first** run (pid 933627) only has
  elimination log lines from tick 3566 onward (bots only, all
  `knockout`, attacker slots 4/7/10) -- the earlier ticks/eliminations
  from that run rotated out of the retained log window, so it is a
  partial trace, but every visible elimination in it is bot-vs-bot
  combat. The **second** run (pid 933814) is a complete trace: 22
  eliminations, `knockout` dominant (14/22), the sole human seat (slot
  0) eliminated by `ring` damage at 55.6s while `aliveAfter: 12`, i.e.
  well after 7 other fighters had already died to `knockout` -- bot-vs-
  bot combat was already well underway before and continued after the
  human's own elimination. A human seat that mostly stood still and
  died to ring pressure still saw a match resolve in 90.9s with 64%
  knockout-caused eliminations, entirely consistent with bots capable
  of really fighting each other, which is exactly what the character
  fix reproduces offline with no human seat at all.
- *Item/hazard spawning disabled offline* -- killed. Both harnesses call
  `createMatchSim`, which always wires in
  `BASH_FIGHTER_ITEM_SET`/`BASH_FIGHTER_HAZARD` -- the same call
  production makes. Nothing to disable.

## What changed

- `scripts/lib/bot-character-assignment.mjs` (new): `assignServerCharacters(seed, numFighters, humanSlots)`
  reproduces `server/src/rooms.ts`'s `startBotFillTimer` character draw
  exactly (same `seedRng`/`nextBounded`/`ALL_CHARACTERS` sequence, same
  `(matchSeed ^ (slot * 0x9e3779b9))` per-slot seed), and gives any
  `humanSlots` seat `PLACEHOLDER_CHARACTER` (`resolveCharacterId`'s own
  fallback for an unset human characterId).
- `scripts/human-analog-metrics.mjs`: builds `characters` via
  `assignServerCharacters` and passes them into `createMatchSim` instead
  of `undefined`.
- `scripts/full-sweep-metrics.mjs`: the main per-arena/difficulty sweep
  now does the same instead of the old uniform-`undefined` choice; the
  separately-existing rotated-roster per-character-survival section
  (further down in the same file) already passed real characters and is
  untouched.
- **Not touched**: `packages/sim/src/sim.ts`'s `DEFAULT_CHARACTER`
  itself, and every other caller of `new Sim(...)` that legitimately
  wants a moveless placeholder (pure physics/determinism unit tests
  that never trigger `advance()`'s attack path). This was a harness
  construction-argument bug, not a sim defect -- nothing about combat,
  knockback, hitstun, or bot AI itself needed to change, and no golden
  hash was touched.

## Before / after, 2026-09-11

Same production data as the table above (8 matches, 133 eliminations,
median 84.4s, knockout 72.2% / ring 18.0% / fall 9.8%).

`scripts/human-analog-metrics.mjs 20 easy` (20 trials, fixed):

| metric | before fix | after fix | production |
|---|---|---|---|
| match duration (median) | ~514s | 78.9s | 84.4s |
| elimination cause | knockout 0%, ring 98%, fall 2% | knockout 73.4%, ring 21.6%, fall 5.0% | knockout 72.2%, ring 18.0%, fall 9.8% |

`scripts/full-sweep-metrics.mjs 4 42000` (all 5 arenas x 3 difficulties,
4 seeds each, fixed): combat share now 57.9%-94.7% across every
combination (median ~85%), boundary 5.3%-42.1%, versus the old
~0-12% combat / ~88-100% boundary at every combination. `battle-royale-20`
EASY specifically (production's most common arena in this log window):
duration 91.8-109.7s (median 106.7s) vs production's 84.4s median on the
same arena family -- a ~1.25x residual gap, not the old ~6x gap.
Gates on this run: all 4 seeds resolved with exactly 1 survivor, 0
timeouts, 0 whole-lobby wipes, 0 double-KOs at every arena/difficulty
combination; novice (passive EASY human) survival unaffected -- 25/25
sampled seeds across all 5 arenas survived the full match, same as
before this change (this fix only touches which characters bots use,
not their AI logic, targeting, or the human-protection tuning).

**Residual gap, stated honestly:** offline EASY durations (median
78.9-111s depending on arena) still run somewhat longer than
production's 84.4s median. Plausible remaining contributors, not fully
isolated here: (1) the human-analog controller is an explicit,
documented guess about human aggression/positioning
(`reactionTicks`/`aimJitter`/`idleProb`/`attackProb`), not a fit to real
data, so a real player who plays more aggressively than the model
would resolve faster; (2) the small 4-8 seed samples above are not a
large-N distribution match; (3) production's own 8-match sample spans
40.4-122.9s, a wide spread that a handful of offline seeds landing at
the high end of that same range (e.g. `the-undercroft` EASY's 191-201s
outlier trials) would not obviously contradict, but was not swept at
higher N here to say for certain it's the same distribution rather than
a real remaining difference. This residual is roughly an order of
magnitude smaller than the gap this fix closes and does not change the
root-cause finding above.

## What this harness cannot measure at all

- Real human aim, reaction time, or decision-making — the human-analog
  controller is a documented guess, not a model of real players.
- Anything about client-side rendering, input latency, or network jitter —
  this is a pure server-side Sim harness.
- Multi-human-seat dynamics (production matches sometimes have 2+ human
  seats; see e.g. matchId "m4" above with humanSeats=2) — this harness only
  ever runs one human-analog seat.

See also: [[20-Player Production-Hardware Measurements 2026-09-08]],
[[Bot Combat Engagement Fix 2026-09-09]], [[Match Duration Contradiction: The Spire Firing Squad 2026-09-09]].
