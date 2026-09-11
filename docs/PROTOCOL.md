# Bash Fighter wire protocol

Source of truth: `packages/net/src/protocol.ts`. This document describes the
same thing in prose; if the two disagree, the code wins and this file is
out of date.

One WebSocket connection at `ws(s)://<host>/socket` per client. Two kinds of
frames flow over it:

- **Control** — JSON text frames. Infrequent (hello, lobby updates, match
  start/end, elimination, errors, ping/pong). Human-readable on purpose:
  contributors can watch these in a browser's network tab.
- **Binary** — dense frames for the hot path: client input (60Hz) and
  server snapshots (`SNAPSHOT_HZ`, currently 20Hz). Every byte here is
  multiplied by tick rate and player count, so these are packed.

## Version handshake

The very first message a client sends must be `hello` with its
`protocolVersion`. If it does not match the server's `PROTOCOL_VERSION`,
the server replies with `error` (`code: "protocol_mismatch"`) and closes
the connection. This is deliberate: silently letting a mismatched client
continue is the worst failure mode for a deterministic sim, since it looks
fine for a while and then two clients disagree about reality with no error
anywhere. Any other message before `hello`, or a malformed message, gets
`error` (`code: "bad_message"`) and a close.

## Control messages, client -> server

| `t` | Fields | Meaning |
|---|---|---|
| `hello` | `protocolVersion`, `name` | First message. Server assigns a match/slot and replies `welcome`. |
| `spectate` | — | Client wants to only watch, not play (used after being assigned, or after elimination to keep watching without reconciliation). |
| `pong` | `id` | Echo of a server `ping`, for RTT measurement. |

## Control messages, server -> client

| `t` | Fields | Meaning |
|---|---|---|
| `welcome` | `protocolVersion`, `clientId`, `slot`, `matchId` | Reply to `hello`. `slot` is `-1` for a pure spectator. |
| `lobby` | `players`, `capacity`, `minimum`, `countdownTicks`, `names` | Sent while a match is filling. `countdownTicks` is `-1` until the minimum player count is reached, then counts down to match start. |
| `matchStart` | `matchId`, `seed`, `numFighters`, `slot`, `settings`, `arenaId`, `names` | The match has started. Every client builds an identical `Sim` from `seed` + `numFighters` + `arenaId`. |
| `eliminated` | `slot`, `placement`, `tick` | A fighter was eliminated. `placement` is `1` for the eventual winner (announced at match end), `N` for the first fighter out. |
| `matchEnd` | `winner`, `leaderboard`, `tick` | Final result. `winner` is `null` only for a genuine simultaneous final KO. |
| `error` | `code`, `message` | `protocol_mismatch`, `bad_message`, `match_full`, or `server_error`. Connection is closed after this is sent. |
| `ping` | `id` | RTT probe; client should reply `pong` with the same `id`. |

## Binary: input (client -> server), 15 bytes

`tag(1)=1 | tick(u32 LE) | buttons(u16 LE) | stickX(i32 LE, Q16.16) | stickY(i32 LE, Q16.16)`

Sent once per local input change (or at least once per local tick) at up to
60Hz. `tick` is the tick the client intends this input to apply from; the
server uses it only to track the most recently-seen input tick per client
(`ackedInputTick` in snapshots) so the client knows which locally-predicted
inputs it can drop. The server never blocks the tick loop waiting for an
input — a fighter with no input for the current tick simply keeps its last
known input, and a disconnected fighter's input decays to neutral.

Any frame that isn't exactly 15 bytes, or whose first byte isn't `1`, is
silently dropped — never trusted, never allowed to reach the sim or crash
the tick loop.

## Binary: snapshot (server -> client), two shapes

Sent to every connected client (players and spectators) at `SNAPSHOT_HZ`
(20/sec), each with its own `ackedInputTick`. As of protocol version 3
(2026-09-11, see wiki "Bandwidth Reduction Pass 2026-09-11") this is
**delta-compressed**: a full keyframe only periodically, deltas the rest of
the time. Which shape a given frame is is the first byte (`tag`).

### Full keyframe (`tag=2`, `SNAPSHOT`)

Header (9 bytes): `tag(1)=2 | tick(u32 LE) | ackedInputTick(u32 LE)`, then
the full serialized sim `StateBuffer` as consecutive `i32` LE words (see
`Sim.saveState`/`loadState` in `packages/sim`). Sent:

- as the very first snapshot on any connection (fresh join, resumed
  reconnect — a connection can never be sent a delta against a baseline it
  could not possibly have), and
- at least once every `KEYFRAME_INTERVAL_SNAPSHOTS` (20, i.e. once/sec at
  20Hz) regardless, as a resync safety net.

### Delta (`tag=3`, `SNAPSHOT_DELTA`)

Header (15 bytes): `tag(1)=3 | tick(u32 LE) | ackedInputTick(u32 LE) |
baseTick(u32 LE) | changedCount(u16 LE)`, then `changedCount` entries of
`index(u16 LE) | value(i32 LE)` (6 bytes each) — the sparse set of
`StateBuffer` words that changed since `baseTick`.

`baseTick` names the specific full keyframe this delta is relative to for
*this connection*. A delta is always relative to the last keyframe sent on
this same connection, never to another delta, so reconstruction is always
one step (copy the keyframe, apply the changed words) — never a chain a
single dropped frame could break silently.

### Client decoding: `SnapshotStreamDecoder`

Both server encoding (`SnapshotStreamEncoder`) and client decoding
(`SnapshotStreamDecoder`) live in `packages/net/src/protocol.ts` — these are
the only supported way to produce/consume this stream; nothing else should
hand-roll delta application. `SnapshotStreamDecoder.decode(bytes)` returns a
reconstructed full `WireSnapshot` exactly like `decodeSnapshot` used to
return directly, so callers elsewhere in the client are unchanged. If a
delta's `baseTick` doesn't match the decoder's current baseline (a dropped
frame, or a stale decoder after some other frame was applied), `decode`
returns `null` for that frame — the caller simply skips that tick's update,
never guesses, and self-heals cleanly at the next full keyframe (at most
`KEYFRAME_INTERVAL_SNAPSHOTS` away).

## Client responsibilities

- Predict only its own fighter locally between snapshots, by replaying its
  own buffered inputs since `ackedInputTick` against a `Sim` seeded
  identically to the server's.
- On each snapshot, `loadState` into its local sim, then re-apply any
  locally buffered inputs newer than `ackedInputTick` to get back to
  "now" — standard client-side prediction + reconciliation, not rollback
  netcode (no other client's inputs are predicted).
- Interpolate remote fighters between snapshots rather than snapping, since
  those arrive at 20Hz but render at up to 60fps+.
- Treat `eliminated` for its own slot as "stop sending input, may
  `spectate`", but keep the connection open and keep applying snapshots.
