# Bash Fighter

Bash Fighter is an open-source, web-based platform fighter in the Super
Smash genre, built for chaotic 20-player free-for-all matches instead of
the traditional 1v1. It runs in the browser, with a server-authoritative
match server for online play.

The project is early. There is no public deployment yet, the only
playable character is a placeholder capsule with four moves, and several
packages described below are still stubs. This document describes what
actually exists in this repository today, not the eventual vision.

## Game design

The default mode is **Last Fighter Standing**: single-elimination battle
royale for up to 20 players, no respawns. The arena collapses as the match
goes on — a deterministic, shrinking blast-zone boundary driven by tick
count and match seed (never wall-clock time) — forcing survivors into
closer combat as the field thins. Eliminated players get a spectate camera
they can move freely while they wait out the rest of the match.

Two alternative modes are part of the design and share the same sim:
**Timed Brawl** (highest KO count within a time limit, with respawns) and
**Stocks** (classic multi-stock elimination). There are no teams in any
mode. 1v1 works as a two-player instance of any of the above; it is not
the primary design target.

See `docs/ARCHITECTURE.md` for how the simulation, rendering, and netcode
fit together.

## Repository layout

npm workspace monorepo:

```
packages/
  sim/      deterministic fixed-point simulation core (real, tested)
  content/  character/stage data format + loader/validator
  render/   WebGL2 renderer (PixiJS), reads sim state, never mutates it
  input/    keyboard/gamepad capture into the sim's InputFrame format
  net/      client-side netcode: wire protocol types, NetMatch client
  app/      Vite app shell wiring sim + render + input + net together
server/    authoritative match server (Node + ws): lobby, rooms, snapshots
docs/       contributor-facing technical docs and the public roadmap
.github/    issue/PR templates and CI workflow
scripts/    offline generators (e.g. the trig lookup table)
```

`packages/sim` has zero dependency on any other package or on the DOM;
everything else depends on it, not the other way around. `packages/net`
holds the client side of the protocol (used by `packages/app`); the
server lives in `server/` as its own workspace since it runs on Node, not
in a browser.

## Running it locally

Requirements: Node 24+ (the test suite relies on Node's built-in
TypeScript type-stripping).

```sh
git clone https://github.com/BashEntertainment/bash-fighter.git
cd bash-fighter
npm install
npm test        # node --test packages/*/test/**/*.test.ts
npm run typecheck  # tsc --noEmit -p tsconfig.json
npm run lint       # eslint .
```

To play locally against yourself or a second local client:

```sh
# terminal 1: the match server (WebSocket on :8081)
cd server
npm run dev

# terminal 2: the app dev server (Vite, proxies /socket and /api to :8081)
cd packages/app
npm run dev
```

Open the Vite dev URL it prints. The local build has two entry points: a
"PLAY" button that runs the sim entirely client-side as an offline test
harness (no server needed), and a "PLAY ONLINE" button that connects to
the match server above, predicts the local fighter, and reconciles against
server snapshots. Both use the same deterministic `packages/sim`.

There is no live public deployment yet.

## Determinism

`packages/sim` is a pure function of previous state plus input: Q16.16
fixed-point math (no floats in sim state), a lookup table for trig instead
of `Math.sin`/`Math.cos`, a seeded PRNG instead of `Math.random`, and no
reads of wall-clock time. This is what lets the server and every client run
the identical simulation and stay in sync, and what lets a client predict
its own fighter locally and reconcile against server snapshots without
drifting. See `CONTRIBUTING.md` for the specific rules this places on any
change to `packages/sim`, and `docs/ARCHITECTURE.md` for why the
architecture is shaped this way.

## Contributing

See [`CONTRIBUTING.md`](./CONTRIBUTING.md) for dev environment setup,
coding standards, and the PR process. [`docs/ROADMAP.md`](./docs/ROADMAP.md)
tracks what's built, in progress, and not started. Use the issue forms
under `.github/ISSUE_TEMPLATE/` to report bugs or propose features, and
see [`SECURITY.md`](./SECURITY.md) to report a vulnerability privately.

## License

AGPL-3.0 (see [`LICENSE`](./LICENSE)), with a Contributor License Agreement
required from contributors — see [`CLA.md`](./CLA.md) for why and for the
CLA text. The project stays AGPL-3.0; the CLA lets Bash Entertainment also
offer the game under additional commercial terms.
