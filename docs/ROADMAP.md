# Roadmap

Honest status as of 2026-09-07. This tracks what exists in this repo, not
aspirations — see the project wiki ("Bash Entertainment Initial Plan") for
the fuller phased plan and rationale.

## Done

- **`packages/sim`** — deterministic fixed-timestep simulation core:
  Q16.16 fixed-point math, LUT-based trig, seeded xorshift128+ PRNG,
  two-fighter physics loop, full combat (state machine, frame data,
  hitboxes/hurtboxes, knockback, hitstun, DI, shield, stocks). Covered by a
  determinism/rollback test harness with a committed golden-hash file.
- **Licensing** — AGPL-3.0 (`LICENSE`), owner decision, paired with a
  planned CLA (mechanism not yet built — see CONTRIBUTING.md).
- **Repo hygiene (this batch)** — README, CONTRIBUTING, Code of Conduct,
  Security policy, issue/PR templates, CI workflow (typecheck/lint/test on
  push and PR).

## In progress

- **`packages/render`** — WebGL/Pixi.js renderer reading sim state.
- **`packages/input`** — keyboard/Gamepad capture into the sim's
  `InputFrame` format.
- **`packages/app`** — Vite app shell wiring sim + render + input together
  into a playable local page. Scaffolded (package.json, an entry point,
  some UI/loop/match files have appeared in-progress); not yet a working
  dev server as of this writing — check the package directly for current
  state, this file will lag it.

All three are being built concurrently by other agents; if you want to pick
up work here, check open issues/PRs first to avoid duplicating in-flight
work.

## Not started

- **`packages/content`** — has a package scaffold and its own tests
  started, but the community character/stage data format and loader
  described in "Engine Architecture: Input, Netplay, and Content Pipeline"
  (wiki) is not complete. This is the on-ramp for external contributors
  who don't want to touch the sim — a priority once the app shell can load
  something.
- **`packages/net`** — rollback-style netcode. Design intent (per the wiki)
  is server-authoritative fixed-tick simulation with client-side prediction
  and interpolation, not peer-to-peer rollback — pure rollback doesn't hold
  up at the target scale of 20 simultaneous players in one match. Nothing
  built yet; this depends on the sim's `saveState`/`loadState` API, which
  exists, and on having something playable locally first.
- **Live deployment** — no game is hosted anywhere yet. The eventual
  target is the Bash Entertainment Hetzner server (`135.181.45.254`),
  which today runs an older, unrelated prototype ("Super Bash") — see the
  wiki's "Super Bash Prototype Analysis" pages for what's there and what,
  if anything, gets carried forward. The plan is to replace it with this
  engine, not extend it.
- **Monetization** — briefing exists in the wiki
  ("Monetization Options for an Open Source Web Fighter"): recommendation
  is server-gated cosmetics plus an official ranked subscription on the
  AGPL core. Nothing built or bought here without owner sign-off; this is
  explicitly post-"game is fun and playable" work.

## Sequencing rationale

Rendering and input before netplay, netplay before monetization: none of
the multiplayer or monetization work is worth doing against a moving
target, and the sim's determinism guarantee (the hard, already-solved part)
is what everything downstream leans on. If you're picking a place to help,
prefer whatever unblocks the next item on this list over something further
down it.
