# Bash Fighter — engine monorepo

Open-source, web-based platform fighter. This repo holds the game engine as
a workspace monorepo, structured for community contribution. Design docs
live in the Bash Entertainment wiki: "Engine Architecture" and
"Engine Architecture: Input, Netplay, and Content Pipeline".

## Packages

- `packages/sim` — **real, implemented.** Deterministic fixed-timestep
  simulation core: Q16.16 fixed-point math, a seeded PRNG, and a minimal
  two-fighter physics loop (gravity, ground collision, jump, horizontal
  movement). No floats, no wall-clock reads, no `Math.random` — every frame
  is a pure function of the previous state and that frame's inputs, so any
  two clients running the same inputs from the same seed reach bit-identical
  state. This is what makes rollback netcode and reproducible replays
  possible later.
- `packages/render` — stub. Will own the WebGL2/Canvas renderer that reads
  sim state and draws it; never mutates sim state.
- `packages/input` — stub. Will own keyboard/Gamepad polling and translate
  raw browser input into the `InputFrame` struct `sim` consumes.
- `packages/net` — stub. Will own the rollback netcode session (GGPO-style)
  and transport.
- `packages/content` — stub. Will own the character/stage data format and
  loader for community-contributed content.
- `packages/app` — stub. Will own the Vite app shell wiring the above
  together into a playable page.

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

## Running tests

```sh
npm install   # see "Known limitations" below
npm test
```

`npm test` runs `node --test packages/*/test/**/*.test.ts`. It uses Node's
native TypeScript support (Node 24+, no build step, no ts-node) rather than
vitest, for reasons explained below. All 42 tests pass as of this writing.

## Known limitations (please read before assuming CI parity)

This repo was built in a container where **the npm registry
(`registry.npmjs.org`) was completely unreachable** (every request failed
with a connection error / 403). That means:

- `typescript`, `vitest`, and `eslint`/`@typescript-eslint/*` listed in
  `devDependencies` were never actually installed, and `npm run typecheck`
  / `npm run lint` / `npm run test:vitest` could not be run for real in that
  environment.
- To still deliver real, runnable, passing tests, `npm test` uses **Node
  24's built-in TypeScript type-stripping** (no separate compile step —
  Node runs `.ts` files directly) with `node:test`/`node:assert` instead of
  vitest. This is why source files import each other with explicit `.ts`
  extensions (e.g. `from './fixed.ts'`) rather than the more common `.js`-
  referring-to-compiled-output convention — Node's type stripping does not
  rewrite extensions, it only strips type syntax.
- `tsconfig.json` is set up for a real `tsc --noEmit` typecheck
  (`strict: true`, `noUncheckedIndexedAccess: true`,
  `allowImportingTsExtensions: true`) and `eslint.config.js` implements the
  sim-restriction rule described above — both should work as soon as
  install succeeds; neither has been verified end-to-end in this
  environment because the tools aren't present. Code was written to strict
  TypeScript conventions throughout, but this is an honest gap: "typecheck
  and lint pass" is unverified, not verified-and-passing.

If you can install packages here, running `npm install && npm run typecheck
&& npm run lint && npm run test:vitest` is worth doing once to confirm
parity with the `node --test` results.

## Repo layout

```
packages/
  sim/      real: fixed-point math, PRNG, sim loop, determinism harness
  render/   stub
  input/    stub
  net/      stub
  content/  stub
  app/      stub
scripts/
  generate-trig-lut.mjs           offline generator for the trig LUT
  run-determinism-harness.ts      regenerates the golden hash file
eslint.config.js
tsconfig.json / tsconfig.base.json
```

No secrets, credentials, or private keys are stored in this repo.
