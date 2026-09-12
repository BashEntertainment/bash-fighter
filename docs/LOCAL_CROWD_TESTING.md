# Local crowd testing (`?crowd20=1`)

A one-command, one-URL way to reproduce a full 20-fighter match on your
own machine, entirely offline (no `server/` process, no public
production lobby) — for QA on anything that only shows up with a crowd:
overlapping slot badges, silhouette/colour legibility, arena-shrink
behaviour with a full field, client perf at 20 fighters, and so on.

## Quick start

```sh
cd packages/app
npm run dev
```

Open `http://localhost:5173/?crowd20=1`, expand "Play locally" and click
Start (or just click Start — `crowd20` fills the local-play character
picker for you). You get an offline 20-fighter free-for-all, one slot of
which is yours to control, running entirely client-side.

Useful extra query params, all optional and all local-play-only (they do
nothing to `?online`/the server path):

- `&seed=<integer>` — pins the match seed. Same seed, same characters,
  same arena, same bot decisions every time: two runs with the same seed
  produce an identical fight (see the reproducibility test below), which
  is what makes a bug reproducible enough to file or to bisect.
  Omit it and it falls back to the wall clock like ordinary local play
  always has.
- `&arena=<id>` — pins the stage instead of letting it be derived from
  the seed, e.g. `&arena=the-atoll` or `&arena=battle-royale-20`. See
  `docs/ADDING_A_STAGE.md` for the current arena ids. An unknown or
  absent id silently falls back to the seed-derived choice, so this is
  invisible to a normal player and to ordinary local play — it only
  matters when you deliberately set it.
- `&mode=timedKO` — runs Timed Brawl (respawns + KO/death scoring, with
  the countdown-clock HUD and score-based end screen) instead of Battle
  Royale, in local play including `?crowd20=1`. This is the only way to
  see the Timed Brawl client experience with a full 20-fighter field
  without standing up a second server instance, since the browser-preview
  tunnel used for automated QA doesn't proxy the websocket upgrade a real
  online match needs. Absent, local play stays Battle Royale exactly as
  before — this changes nothing for a normal player, who never sets it,
  and production's own default (also Battle Royale) is untouched.
- `&timeLimit=<seconds>` — with `&mode=timedKO`, shortens (or lengthens)
  the match clock for a faster QA loop instead of the mode's normal
  default. Ignored without `&mode=timedKO`.
- `&mode=stocks` — runs Stocks (2 lives each by default, respawn until
  your stocks run out, then permanent elimination; last fighter with
  stocks remaining wins) instead of Battle Royale, same rationale as
  `&mode=timedKO` above: it's the only way to see the Stocks HUD/end
  screen with a full 20-fighter field locally.
- `&stocks=<n>` — with `&mode=stocks`, overrides the starting life count
  (production default: 2, see `docs/MATCH_MODES.md` for why). Ignored
  without `&mode=stocks`.

Example for a reproducible crowd match on a specific stage:

```
http://localhost:5173/?crowd20=1&seed=42&arena=the-atoll
```

## What was actually broken

`?crowd20=1` filled the local match's 20 character slots, but
`Match.tick()` still only polled `InputManager`, which always returns
exactly 2 `InputFrame`s — one per local keyboard-controlled slot. `Sim.
advance()` asserts its input array's length equals the fighter count
(see "Sim: advance() input validation" in `packages/sim/test`), so the
very first tick of any local match with more than 2 fighters threw
`advance: expected N inputs, got 2`. That is the entire story: nothing
subtler, no sim/render bug, just a debug flag that was wired to fill
character slots without ever wiring input for the slots it added. A
previous agent hit this, correctly saw it "threw every tick", and
(reasonably, without digging further) dropped it as out of scope.

Production's real 20-fighter matches never hit this because the match
*server* (`server/src/match.ts`) fills every non-human seat with a
`BotController` before the first tick. Local play had no equivalent.

## The fix

`packages/app/src/local-crowd-bots.ts` adds two small pure functions,
factored out specifically so they're usable without a browser/canvas:

- `buildLocalBots(seed, numFighters, humanSlotCount)` — returns a
  `Map<slot, BotController>` covering every slot at or after
  `humanSlotCount`, each seeded via `deriveBotSeed(seed, slot)` and run
  at `BotDifficulty.EASY` (the difficulty production actually runs, per
  "Bot Difficulty Correction and Human-Survival Fix") — the same
  construction the server uses per-seat, just decided by slot index
  instead of a per-seat `isBot` flag.
- `buildTickInputs(sim, polled, bots, numFighters)` — builds one
  `InputFrame` per fighter slot every tick: a bot slot asks its
  `BotController` what to do, a human slot uses whatever
  `InputManager.poll()` returned, and (defensively) any slot covered by
  neither gets a neutral idle frame instead of silently shortening the
  array.

`Match`'s constructor now takes two more optional trailing parameters,
`humanSlotCount` (default `2`, i.e. unchanged for ordinary local play)
and `arenaIdOverride` (default unset, i.e. seed-derived as before), and
`Match.tick()` calls `buildTickInputs` instead of trusting
`InputManager.poll()`'s length directly. `main.ts` reads `?seed=` and
`&arena=` and threads them through. None of this touches
`packages/sim` — determinism-sensitive simulation code is unchanged; this
is purely how the app assembles the input array it hands to `Sim.
advance()`.

## Stage selection (issue #19)

Issue #19 asked for a dev-only way to pick the stage instead of leaving
it to the seed. `&arena=<id>` above is that, for the local/offline path.
It does not touch online play, which gets its arena id from the server
and has no client-side override — see the issue for that remaining scope.

## Regression coverage

`packages/app/test/local-crowd-bots.test.ts` imports `buildLocalBots`/
`buildTickInputs` directly (not through `Match`, which needs a
Renderer/canvas this repo's DOM-less test setup doesn't have — see the
note in `test/match-overlay.test.ts`) and, against a real `Sim`:

1. builds a real 20-fighter match and runs 600 ticks (~10s of match
   time) asserting `Sim.advance()` never throws and the input array is
   always exactly `numFighters` long — this is the exact assertion that
   used to fail;
2. asserts every fighter took damage or was eliminated by then, so the
   test can't pass vacuously with bots that never act;
3. asserts human slots never get a bot;
4. asserts two runs with the same seed produce byte-identical
   `Sim` state after 120 ticks (the reproducibility claim above, checked
   for real rather than just asserted in prose).

Run it on its own with:

```sh
node scripts/run-tests.mjs packages/app/test/local-crowd-bots.test.ts
```

or as part of the normal `npm test`.
