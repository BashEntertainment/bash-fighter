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

## Honest verdict

**The harness's plumbing is trustworthy; the numbers it currently produces
are not, and the disagreement is real and large, not a rounding difference.**

Specifically:
- Match duration and human-elimination-time are **off by roughly 5-10x**
  (harness matches run 8-10 minutes; production matches resolve in 40s-2min).
- The elimination-cause split is **inverted**: production is dominated by
  genuine knockouts (72%); the harness — at both EASY and HARD bot difficulty
  — produces almost none (0%), with matches instead dragging out until the
  ring-shrink backstop kills everyone.
- This is not a bug introduced by this harness. A plain 20-bot-no-human
  match, run through `full-sweep-metrics.mjs` unmodified with the same
  corrected ceiling, shows the identical pattern (0% combat share across
  every arena/difficulty combination tested during this pass) — see that
  script's own `combat=0%` rows. The human-analog controller did not cause
  this; it inherited it.
- Root cause is NOT diagnosed here — that is a sim/bot-AI behavior question
  (whether bots are currently fighting each other at all in extended
  matches), out of scope for this harness/measurement task, and out of
  scope for this agent's file ownership (`packages/sim/`, `server/`). It is
  flagged, not fixed.

**What can be trusted right now:** the harness's mechanics — it correctly
builds production-identical Sims via `createMatchSim`, correctly reads
`eliminationEvents` cause/attacker/percentAtDeath the same way the server's
own log line does, correctly avoids the ceiling-timeout artifact, and its
JSON output format is directly comparable field-for-field against
`journalctl`'s `elimination` and `matchSummary` lines (see table above and
`scripts/human-analog-metrics.mjs`'s header comment for the exact schema
mapping).

**What cannot yet be trusted:** the *absolute* duration and cause-split
numbers this harness produces. Bot-vs-bot combat is not currently
reproducing in extended offline play the way it does in real production
matches with a human present, for reasons this task did not investigate.
Anyone using this harness to argue "combat share should be X%" or "matches
should last Y seconds" must check that claim against fresh production logs
first — this doc's rule stands: **production logs win any disagreement.**

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
