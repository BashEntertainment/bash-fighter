# Bash Fighter — engine monorepo

Open-source, web-based platform fighter. This repo holds the game engine as
a workspace monorepo, structured for community contribution. Design docs
live in the Bash Entertainment wiki: "Engine Architecture" and
"Engine Architecture: Input, Netplay, and Content Pipeline".

## Packages

- `packages/sim` — **real, implemented, tested.** Deterministic
  fixed-timestep simulation core: Q16.16 fixed-point math, a seeded PRNG,
  and a full two-fighter combat loop (movement, jumping, hitboxes/hurtboxes,
  hitstun, knockback scaling, DI, shield, stocks). No floats in game state,
  no wall-clock reads, no `Math.random` — every frame is a pure function of
  the previous state and that frame's inputs, so any two clients running
  the same inputs from the same seed reach bit-identical state. This is
  what makes server-authoritative resimulation and reproducible replays
  possible later.
- `packages/content` — in progress. Owns the character/stage data format
  and loader for community-contributed content; has a package scaffold and
  its own tests started.
- `packages/render`, `packages/input`, `packages/app` — actively being
  built (by other contributors/agents as of this writing): the WebGL/Pixi
  renderer, keyboard/Gamepad input capture, and the Vite app shell that
  wires sim + render + input into a playable page. Check each package's
  `src/` directly for current state — this README won't always be first to
  reflect in-flight work; `docs/ROADMAP.md` tracks it at a coarser grain.
- `packages/net` — not started. Will own the server-authoritative netcode
  session (fixed-tick simulation with client prediction/interpolation,
  chosen over peer-to-peer rollback because that model doesn't hold up at
  the target scale of 20 simultaneous players) and transport.

## Why `packages/sim` looks the way it does

- **Q16.16 fixed-point** (`packages/sim/src/math/fixed.ts`): all sim state
  (position, velocity) is a 32-bit integer where the low 16 bits are
  fractional. Add/sub/mul/div/sqrt are implemented with integer/BigInt math
  only, so results are identical across browsers and CPUs — a `+` on two
  floats can legitimately differ in the last bit between engines, and that
  is enough to desync a rollback match over time.
- **Trig via a precomputed LUT, not `Math.sin`/`Math.cos` at runtime**:
  `packages/sim/src/math/trigTable.ts` is *generated* by
  `scripts/generate-trig-lut.mjs` (run once, offline, checked in as static
  data) and committed. `packages/sim` itself never calls `Math.sin` — it only
  indexes into the checked-in table. This is enforced by the ESLint config's
  `no-restricted-syntax` rule scoped to `packages/sim/src` (see
  `eslint.config.js`), which also forbids `window`, `document`, `Date.now`,
  `performance.now`, and `Math.random` in that package.
- **Seeded PRNG** (`packages/sim/src/math/prng.ts`): xorshift128+, seeded via
  splitmix64 so small seeds still produce well-mixed state. A fixed seed
  always produces the same sequence — pinned by a golden-sequence test.
- **`Sim` class** (`packages/sim/src/sim.ts`): all state lives in one
  preallocated `Int32Array`. `advance(inputs)` mutates it in place — no
  allocation in the hot loop. `createStateBuffer()` allocates a same-shaped
  buffer for the caller to reuse; `saveState(buf)`/`loadState(buf)` copy into
  or out of it without allocating. This is the shape a rollback netcode
  layer needs: keep a ring of `StateBuffer`s, save one per tick, and
  `loadState` + re-`advance` to resimulate after a remote correction.
- **Determinism harness** (`packages/sim/test/determinism.test.ts`): replays
  a fixed recorded input stream (`test/fixtures/replay-input-stream.ts`),
  hashes full serialized state every tick with a pure-integer FNV-1a hash
  (`src/hash.ts` — no `node:crypto`, so it also works unmodified in the
  browser), and asserts the hashes match a committed golden file
  (`test/golden/replay-hashes.json`) exactly. It also proves the rollback
  guarantee directly: saving state mid-replay, loading it into a *second*
  `Sim` instance that started from a deliberately wrong seed, and resuming
  from there reproduces the same tail of hashes as an uninterrupted run.

## Quickstart

```sh
git clone <this repo>
cd bash-fighter
npm install
npm run typecheck
npm run lint
npm test
```

`npm test` runs `node --test packages/*/test/**/*.test.ts` — Node's
built-in TypeScript type-stripping (Node 24+; CI runs Node 24), no build
step, no ts-node. This is why source files import each other with explicit
`.ts` extensions (e.g. `from './fixed.ts'`) rather than the `.js`-referring-
to-compiled-output convention — type stripping doesn't rewrite extensions,
it only strips type syntax. `npm run typecheck` runs `tsc --noEmit`;
`npm run lint` runs ESLint, including the determinism-restriction rule
described above, scoped to `packages/sim/src`.

There's no dev server yet for the actual game — `packages/app` is under
active construction (see above). Once it has a `dev` script wired to Vite,
this section will show the command to run it locally.

## Repo layout

```
packages/
  sim/      real, tested: fixed-point math, PRNG, sim loop, determinism harness
  content/  in progress: character/stage data format + loader
  render/   in progress: WebGL/Pixi renderer
  input/    in progress: keyboard/Gamepad polling -> InputFrame
  app/      in progress: Vite app shell
  net/      not started: server-authoritative netcode + transport
scripts/
  generate-trig-lut.mjs           offline generator for the trig LUT
  run-determinism-harness.ts      regenerates the golden hash file
docs/
  ROADMAP.md        what exists, what's next, sequencing rationale
.github/            issue/PR templates, CI workflow
eslint.config.js
tsconfig.json / tsconfig.base.json
```

No secrets, credentials, or private keys are stored in this repo.

## Contributing

See [`CONTRIBUTING.md`](./CONTRIBUTING.md) for dev environment setup,
coding standards, and the PR process. Use the issue templates under
`.github/ISSUE_TEMPLATE/` to report bugs or propose features. See
[`docs/ROADMAP.md`](./docs/ROADMAP.md) for what's built, in progress, and
not started, and [`SECURITY.md`](./SECURITY.md) to report a vulnerability.

## License

AGPL-3.0, with a Contributor License Agreement required from contributors
(owner decision — mechanism not yet built, see CONTRIBUTING.md). See
[`LICENSE`](./LICENSE) for the full text.
