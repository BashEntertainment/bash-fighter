# Architecture overview

This is a contributor-facing summary of how Bash Fighter is put together.
It is deliberately narrower than the full internal design docs; if
something here looks underspecified, that's often on purpose — ask in an
issue rather than guessing at intent.

## Package boundaries

```
packages/sim      deterministic simulation. No DOM, no rendering, no I/O.
packages/content  character/stage data format + loader/validator.
packages/render   WebGL2 (PixiJS) rendering. Reads sim state, never mutates it.
packages/input    device polling/remapping into a per-frame input struct.
packages/net      client-side wire protocol types + the NetMatch client.
packages/app      glue: game loop, UI shell, menus. The Vite app.
server/           the authoritative match server (Node + ws).
```

The dependency direction only goes one way: `sim` depends on nothing else
in the repo; `content` depends only on `sim`'s types; `render`, `input`,
and `net` each depend on `sim` but not on each other; `app` wires all of
them together. This means a contributor adding a character can work
entirely inside `packages/content` without reading `sim` internals, and
`sim` can be unit-tested and hashed in CI without a browser DOM.

## The simulation is deterministic on purpose

`packages/sim` advances in a fixed 60Hz timestep, decoupled from render
rate — the renderer interpolates between the last two sim states rather
than the sim adapting to frame rate. All sim state (position, velocity,
knockback, percent) is Q16.16 fixed-point (32-bit integers, 16 fractional
bits), not floating point, because plain IEEE-754 float arithmetic is
*not* guaranteed bit-identical across browsers/CPUs once transcendental
functions or accumulation order are involved. So:

- Fixed-point add/sub/mul/div/sqrt (`packages/sim/src/math/fixed.ts`) are
  implemented with integer/BigInt math, not native float ops.
- Trig comes from a precomputed lookup table
  (`packages/sim/src/math/trigTable.ts`), generated once offline by
  `scripts/generate-trig-lut.mjs`. That script is the only place in the
  repo that calls `Math.sin`/`Math.cos`.
- Randomness comes from a seeded PRNG (xorshift128+, seeded via
  splitmix64), never `Math.random()`.
- Entities are iterated in a stable, monotonic order (integer entity ID),
  never Map/Set/object insertion order.

The payoff: two processes (two browsers, or a browser and the server)
that start from the same seed and receive the same sequence of inputs
produce bit-identical state forever. That's what makes server-authoritative
play and client-side prediction/reconciliation possible without gradual
drift. See `CONTRIBUTING.md` for the specific rules this places on changes
to `packages/sim`, and `packages/sim/test/determinism.test.ts` for the
test that proves it (replays a recorded input stream, hashes full state
every tick, and checks the hashes against a committed golden file).

## Sim data model, in brief

- Entities (fighters, and eventually projectiles/items) are packed into
  preallocated typed arrays, not one object per entity — no allocation in
  the hot `advance()` loop.
- A fighter's behavior comes from a declarative state machine (`idle`,
  `run`, `jump`, `airborne`, `attack`, `hitstun`, `shield`, `ledge`,
  `dead`) with every legal transition listed once, not scattered
  conditionals.
- Moves are data: a linear list of frame windows (startup/active/endlag),
  each declaring active hitboxes where relevant. `packages/content`
  authors moves in this shape; `packages/sim` just interprets it.
- Knockback scales with the target's accumulated percent and the move's
  base/growth knockback values; hitstun duration is proportional to the
  resulting knockback magnitude. See the "Combat Model" design doc on the
  project wiki for the exact formula and current placeholder-character
  constants.
- The arena defines a fixed-point blast-zone boundary. In the default
  Last Fighter Standing mode this boundary shrinks over the course of a
  match on a schedule driven by tick count and match seed — never
  wall-clock time — so it replays identically given the same seed.

## Netcode: server-authoritative, not peer-to-peer rollback

Peer-to-peer rollback (GGPO-style) is the classic fighting-game netcode
model, but it doesn't scale to a 20-player free-for-all: every peer would
need a connection to every other peer, and resimulating the whole match on
every misprediction gets expensive fast with that many inputs in flight.
Bash Fighter instead uses:

- **Server-authoritative simulation.** `server/` runs the same
  deterministic `packages/sim` and is the single source of truth for
  match state. It receives input frames from clients and broadcasts state
  snapshots at a fixed rate (see `docs/PROTOCOL.md`).
- **Client-side prediction, for the local player only.** The client runs
  its own local copy of `Sim`, advancing it every tick using the local
  player's real input and neutral input for every other slot. It never
  trusts its own guess about *other* players between snapshots — only the
  locally predicted fighter is rendered from local sim state.
- **Reconciliation.** On every received snapshot, the client loads the
  authoritative state into its local sim (which also fast-forwards the
  local tick counter to the server's), discards acknowledged buffered
  inputs, and replays any newer local inputs forward to catch back up to
  the client's current tick — the standard rollback-netcode reconciliation
  step, just applied against a server snapshot instead of a peer.
- **Snapshot interpolation, for remote players.** Non-local fighters are
  rendered by linearly interpolating between the last two received
  snapshots over wall-clock time, rather than being simulated locally.
- This is implemented in `packages/net`/`packages/app` (`NetMatch`) on the
  client side and `server/src/match.ts` / `server/src/rooms.ts` on the
  server side. One WebSocket connection per client at `/socket`; see
  `docs/PROTOCOL.md` for the exact message set.

## What's real vs. stubbed today

- `packages/sim`: implemented and tested — fixed-point math, PRNG, the
  full N-fighter (2–32) combat loop, elimination, placement, the
  collapsing arena, and a determinism/rollback test harness.
- `server/`: implemented — lobby, room isolation, match start/end,
  broadcasting snapshots, an integration test connecting multiple real
  WebSocket clients and diffing their final state hashes.
- `packages/net` + `packages/app` online mode: implemented for a basic
  match (prediction, reconciliation, interpolation, connection-state UI).
  Known gaps: the in-match HUD doesn't render in online mode yet,
  snapshots are full-state rather than delta-compressed, the spectator
  path infers elimination from stocks instead of reading the real sim
  fields, reconnection to an in-progress match isn't implemented, and
  there's no bot/AI lobby filling.
- `packages/content`: the data format, a validator, and one placeholder
  character (four moves) exist. The broader community content pipeline is
  still being built out.
- `packages/render`, `packages/input`: implemented enough to drive a
  playable local build (WebGL2 via PixiJS, keyboard/gamepad input).
- Everything here is placeholder art and one character. The game is not
  yet deployed publicly.
