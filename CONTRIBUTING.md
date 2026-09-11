# Contributing to Bash Fighter

Bash Fighter is an open-source (AGPL-3.0), web-based platform fighter
built for chaotic 20-player free-for-all matches. Before your first pull
request, read [`CLA.md`](./CLA.md): contributions require agreeing to a
Contributor License Agreement. It is a licence grant, not a copyright
assignment — you keep ownership of what you write. The signing mechanism
is not yet built; until it is, a maintainer will follow up on your first
PR with instructions.

See [`README.md`](./README.md) for the package layout and
[`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) for the technical design.

## Dev environment setup

Requirements: Node 22+ or 24+ (the test suite relies on Node's built-in
TypeScript type-stripping). `npm test` and `npm run test:server` go
through `scripts/run-tests.mjs`, which probes whether the running Node
actually accepts `--test-isolation=none` and falls back to a slower but
still memory-safe mode if it doesn't -- see "Running the tests" below for
why this is a probe and not a version check.

```sh
git clone https://github.com/BashEntertainment/bash-fighter.git
cd bash-fighter
npm install
npm test            # packages/*/test — see "Running the tests" below
npm run test:server # server/test — not covered by `npm test`
npm run test:all     # both of the above; what CI runs
npm run typecheck   # tsc --noEmit -p tsconfig.json
npm run lint         # eslint .
```

To run the app and server locally, see the "Running it locally" section
of `README.md`. Work inside a single package where possible and run that
package's tests before opening a PR.

To reproduce a full 20-fighter crowd (for legibility/perf/HUD QA) without
spinning up the server or joining a live production lobby, see
[`docs/LOCAL_CROWD_TESTING.md`](./docs/LOCAL_CROWD_TESTING.md) —
`?crowd20=1` on the local Vite dev server.

### Running the tests

`npm test` runs every test in `packages/*/test/**/*.test.ts` — 431 tests as of 2026-09-10 (this number grows regularly; don't be alarmed if `npm test`'s own summary reports more than what's written here — the summary is the source of truth, not this doc)
as of this writing, including the heavy N-fighter/battle-royale suites
(`determinism-20`, `stress-match-end`, `items-hazards`, `bot`). Nothing
is skipped by default; there is no separate "heavy" script to remember.

It runs as `node scripts/run-tests.mjs packages/*/test/**/*.test.ts
scripts/test/*.test.ts`. The `--test-isolation=none` flag it passes to
`node --test` is the important part and is what fixes the memory problem
-- without it, Node's test runner spawns one child process per test
*file*, and each of those processes costs roughly 150MB of baseline
overhead before it runs a single assertion. With the default test
concurrency (tied to your CPU core count), that overhead multiplies: on
an 8-way-concurrent run we measured peak RSS of **~838MB** for a suite
whose actual test logic needs under 150MB. That is what OOM-kills the
suite on a small container or a modest contributor laptop — it is a test
*runner configuration* problem, not a memory leak in `packages/sim` or
anywhere else in the library code. `--test-isolation=none` runs the whole
suite in a single process instead, which we measured at a peak RSS of
**~148-183MB** and a wall time of **6-12 seconds**, regardless of core
count. See the "Test suite memory" table below for the full numbers.

`scripts/run-tests.mjs` doesn't assume the flag exists just because the
Node major version looks new enough: it spawns the real Node binary with
the flag once, first, and checks whether it errors with "bad option"
(see `scripts/lib/isolation-flag.mjs`). Two earlier versions of this
wrapper guessed from a version number or from
`process.allowedNodeEnvironmentFlags` and both shipped broken -- Node
22.23.2's CLI genuinely doesn't accept `--test-isolation`, even though
the *programmatic* `node:test` `isolation` option landed in 22.8.0; the
CLI flag stabilised separately, later. If the probe finds the flag
missing, the wrapper falls back to `--test-concurrency=1` with default
(per-file) isolation -- slower, but still memory-safe -- and says so on
stderr instead of failing outright.

`server/test/*.test.ts` (websocket reconnection, mid-match join, spectator
rate — real sockets and timers) is a separate script, `npm run test:server`,
kept apart from the packages suite's single process because it uses real
network sockets and timers. It's small (16 tests, ~20-35s depending on
container load) so it doesn't need
splitting further. **It is not included in `npm test`** — run it
explicitly. CI runs both via `npm run test:all`, so don't rely on `npm
test` alone to catch a server regression.

If you're on a genuinely memory-constrained machine, run test files one
package at a time instead of the aggregate scripts:

```sh
node --test --test-isolation=none packages/sim/test/*.test.ts
```

#### Test suite memory (measured 2026-09-08, in a 1.9GB/1-vCPU container)

| Command | Tests | Peak RSS | Wall time |
|---|---|---|---|
| `npm test` (isolation=none, this repo's default) | 431 | ~148-183MB | 6-12s |
| same suite, `--test-concurrency=8`, no isolation flag (the old script's behaviour on any multi-core machine) | 334 (measured 2026-09-08; test count has grown since) | ~838MB | ~12s |
| `npm run test:server` | 16 | not separately measured; small | ~20-35s |

The 838MB figure is not hypothetical — it's what the old `npm test`
script actually did on any machine with several CPU cores (most
contributor laptops and CI runners qualify). This container only avoided
it before because it has a single vCPU, so the old default's concurrency
happened to collapse to 1 here. On a multi-core machine the old script
really did risk OOM; `--test-isolation=none` is the fix, not a bigger
memory limit.

## Determinism rules (read this before touching `packages/sim`)

`packages/sim` must be a pure function of the previous state and the
current tick's inputs. Two clients (or a client and the server) that start
from the same seed and receive the same inputs must reach bit-identical
state, forever. Breaking this doesn't throw an error — it silently desyncs
players from each other, which is much worse than a crash and much harder
to debug after the fact. So, inside `packages/sim/src`:

- **No floats in simulation state.** Position, velocity, knockback,
  percent, and any other quantity that affects the outcome of a match are
  Q16.16 fixed-point integers (`packages/sim/src/math/fixed.ts`), not
  JavaScript numbers used as floats. A `+` on two floats can legitimately
  differ in the last bit between browsers/CPUs; that is enough to desync a
  match over time.
- **No `Math.random`.** Use the seeded PRNG (`packages/sim/src/math/prng.ts`,
  xorshift128+ seeded via splitmix64). A fixed seed must always produce
  the same sequence.
- **No `Date.now()` or `performance.now()`.** The sim only knows about tick
  count, never wall-clock time. Anything time-based (e.g. the arena
  collapse schedule) is driven by tick count and match seed.
- **No `Math.sin`/`Math.cos`/`Math.pow`/`Math.exp`/`Math.log` at runtime.**
  Transcendental `Math.*` implementations vary by JS engine, which breaks
  cross-client determinism. Trig goes through the precomputed LUT
  (`packages/sim/src/math/trigTable.ts`, generated offline by
  `scripts/generate-trig-lut.mjs` — that script is the only place in the
  repo allowed to call `Math.sin`/`Math.cos`).
- **No allocation in hot paths.** `Sim.advance()` runs every tick for every
  fighter; it mutates a preallocated `Int32Array` in place rather than
  allocating. Keep that property in any change to the tick loop.
- **Stable iteration order.** Entities are processed in a fixed, monotonic
  order (integer entity ID), never Map/object/Set insertion order, since
  insertion order is easy to accidentally make non-deterministic.

These rules are partly enforced by `eslint.config.js` (`no-restricted-syntax`
scoped to `packages/sim/src`, blocking `window`, `document`, `Date.now`,
`performance.now`, and `Math.random`). The lint rule cannot catch every
case (e.g. a stray `Math.sin` disguised through indirection, or float
arithmetic on values that happen to look like integers), so review is the
real backstop. If you think a change needs an exception, say so explicitly
in the PR and explain why — don't route around the rule silently.

The determinism test (`packages/sim/test/determinism.test.ts`) replays a
recorded input stream, hashes full sim state every tick, and asserts the
hashes match a committed golden file exactly. If your change legitimately
changes sim behavior, regenerate the golden file and say so plainly in the
PR description — a silently-updated golden file is exactly the kind of
change a reviewer needs to know about.

## Adding a new character

Characters are data, not code changes to the sim. Each character lives in
its own directory under `packages/content/src/characters/<name>/`, with a
`data.ts` describing its stats and four-move kit and an `animation.ts` for
its pose data. The existing characters (`placeholder`, `ballast`,
`voltling`, `reed`, `scrapper`, `anchor`, `zephyr`, `wisp`) are the
reference pattern — copy the closest archetype to what you're building
and adjust the numbers and hitboxes rather than starting from a blank
file. Run the content validator and the existing character tests, and add
a test for your character alongside the others in
`packages/content/test/`. New characters should read distinctly from the
existing roster at 20-fighter zoom (silhouette, proportions, not just
color) — see `docs/ARCHITECTURE.md` for the readability constraints this
places on new designs.

For a full annotated walkthrough — data file, validator, render shape,
and roster registration, with real file paths and commands — see
[`docs/ADDING_A_CHARACTER.md`](./docs/ADDING_A_CHARACTER.md).

## Adding a new stage

Stages (called "arenas" in code — both names mean the same thing) are
also data, not sim code. Each one is a single `ArenaData` object under
`packages/content/src/arenas/<name>/data.ts` (platforms, walls, blast-rect
bounds, spawn points), registered in `packages/content/src/arenas.ts`.
The existing five (`battle-royale-20`, `the-undercroft`, `the-spire`,
`the-foundry`, `the-atoll`) are the reference pattern. Run the content
validator (`assertValidArena`) and `npm test`, which stress-tests every
registered arena for determinism.

For a full annotated walkthrough with real file paths and commands, see
[`docs/ADDING_A_STAGE.md`](./docs/ADDING_A_STAGE.md).

## Coding standards

- TypeScript, strict mode (`tsconfig.base.json`: `strict`,
  `noUncheckedIndexedAccess`). Keep new code passing `npm run typecheck`.
- Fix `npm run lint` warnings you touch; don't let a PR add new ones.
- Match the existing file's style (naming, module layout) rather than
  introducing a new convention in one corner of the codebase.

## Pull request process

1. For anything non-trivial (new feature, behavior change, new package),
   open an issue first so the design gets discussed before code — use the
   forms under `.github/ISSUE_TEMPLATE/`.
2. Keep PRs focused: one logical change per PR. Large mechanical
   refactors should be their own PR, separate from behavior changes.
3. Fill in the PR template (`.github/PULL_REQUEST_TEMPLATE.md`), including
   the determinism checklist if your change touches `packages/sim`.
4. CI (`.github/workflows/ci.yml`) must pass: install, typecheck, lint,
   test, on Node 22 and Node 24. A maintainer reviews and merges; per
   project policy, community PRs are never merged to `main` without
   review and a passing CI run.
5. Be responsive to review comments — PRs that go quiet for a long time
   may be closed and can be reopened later.

## Reporting bugs or requesting features

Use the forms in `.github/ISSUE_TEMPLATE/`. For a security vulnerability,
do not open a public issue — see [`SECURITY.md`](./SECURITY.md).

## Discussions vs. issues

**GitHub Discussions is not enabled on this repository yet** (it's a
repo-admin setting current maintainer tooling can't flip; tracked
internally). The `/discussions` link 404s today. Until it's turned on,
open an issue instead (use the "Question / open-ended" option in the
issue form if your topic isn't a concrete bug or scoped feature) and it
will be triaged manually.

Once enabled, the intended split is: issues are for concrete, actionable
work (a specific bug with repro steps, or a feature request scoped
enough to become a PR), and everything more open-ended goes in
Discussions:

- **Playtest feedback** — you played a match and want to say how it felt
  (pacing, whether the collapsing ring made sense, whether you understood
  why you lost). This is not a bug report unless something was actually
  broken.
- **Feature ideas** — a rough idea that isn't scoped enough to be a PR
  yet. Discuss it first; if it firms up into something buildable, it can
  become an issue.
- **Q&A / general** — how something works, how to run a piece of the
  codebase, anything that isn't a defect or a concrete proposal.

If you're not sure which one, start with a discussion — it's easy to
turn a discussion into an issue later, and much noisier to do the
reverse.
