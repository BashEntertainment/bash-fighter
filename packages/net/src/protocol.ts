/**
 * Bash Fighter wire protocol.
 *
 * Two channels over one WebSocket:
 *
 *  - Control messages are JSON text frames. They are infrequent (join, match
 *    start, elimination, match end), so legibility is worth more than bytes,
 *    and being able to read them in a browser's network tab is a real debugging
 *    advantage for contributors.
 *  - Inputs and snapshots are binary frames. These are the hot path: inputs go
 *    up at 60Hz and snapshots come down at SNAPSHOT_HZ, so every byte is
 *    multiplied by the tick rate and the player count.
 *
 * Both sides must agree on PROTOCOL_VERSION. A mismatch is refused at the
 * handshake with an explicit error rather than allowed to desync silently,
 * which is the single most confusing failure mode a deterministic netcode can
 * have: play looks fine for a few seconds and then two clients disagree about
 * reality with no error anywhere.
 */

/** Bumped to 2 for resume-token reconnection support (hello may carry a
 *  `resume` token, welcome always carries one). A mismatch is still refused
 *  explicitly at the handshake rather than silently misbehaving -- see the
 *  module comment above. */
export const PROTOCOL_VERSION = 2;

/** Snapshots per second sent to each client. The sim runs at 60Hz; clients
 *  interpolate between snapshots and predict their own fighter, so the
 *  broadcast rate can be well below the tick rate. */
export const SNAPSHOT_HZ = 20;

/** Binary frame discriminators (first byte of a binary frame). */
export const BinaryTag = {
  INPUT: 1,
  SNAPSHOT: 2,
} as const;

// ---------------------------------------------------------------------------
// Control messages: client -> server
// ---------------------------------------------------------------------------

export interface HelloMessage {
  t: 'hello';
  protocolVersion: number;
  /** Display name. Server sanitises and truncates; never trusted. */
  name: string;
  /** Opaque resume token from a previous `welcome`, presented to reclaim a
   *  disconnected seat in an in-progress (or just-ended) match instead of
   *  joining a fresh lobby. Absent for a normal new join. Unguessable --
   *  see server/src/match.ts's token generation -- so presenting one is the
   *  ONLY way to reclaim a seat; there is no other path that hands a seat
   *  back based on slot number or match id alone. */
  resume?: string;
  /** Requested character id from @bash-fighter/content's roster (e.g.
   *  'placeholder', 'ballast'). Optional and defaults to the placeholder
   *  character server-side -- required for backward compatibility with
   *  any client built before character selection existed. Unrecognised
   *  ids are also treated as absent by the server, never rejected. */
  characterId?: string;
}

/** Sent by a client that wants to keep watching after being eliminated. */
export interface SpectateMessage {
  t: 'spectate';
}

export interface PongMessage {
  t: 'pong';
  /** Echo of the server's ping id, for round-trip measurement. */
  id: number;
}

export type ClientControlMessage = HelloMessage | SpectateMessage | PongMessage;

// ---------------------------------------------------------------------------
// Control messages: server -> client
// ---------------------------------------------------------------------------

export interface WelcomeMessage {
  t: 'welcome';
  protocolVersion: number;
  /** Opaque connection id, for logs and reconnection. */
  clientId: string;
  /** Fighter slot in the match, or -1 for a pure spectator. */
  slot: number;
  matchId: string;
  /** Opaque resume token for this seat, or null for a pure spectator (a
   *  spectator holds no reclaimable seat). Present it in a later `hello`'s
   *  `resume` field to reclaim this exact seat after a disconnect, as long
   *  as the seat is still within its grace window. Generated with
   *  crypto.randomBytes server-side -- not derivable from slot or matchId. */
  resumeToken: string | null;
  /** True when this welcome is the result of successfully reclaiming a
   *  disconnected seat via a resume token, so the client knows to treat
   *  this as "you're back" rather than "you're new". */
  resumed: boolean;
}

/** Sent while a match is filling, so the client can show something honest
 *  instead of a blank screen. */
export interface LobbyMessage {
  t: 'lobby';
  players: number;
  /** Slots the match will start with once full. */
  capacity: number;
  /** Minimum players needed to start early. */
  minimum: number;
  /** Ticks until the match starts anyway, or -1 if not counting down. */
  countdownTicks: number;
  names: string[];
}

export interface MatchStartMessage {
  t: 'matchStart';
  matchId: string;
  /** PRNG seed. Every client builds an identical Sim from this. */
  seed: number;
  numFighters: number;
  /** Which fighter this client controls, or -1 when spectating. */
  slot: number;
  /** Serialised match settings (win condition, stocks, time limit). */
  settings: unknown;
  /** Identifier of the arena in @bash-fighter/content. */
  arenaId: string;
  names: string[];
  /** Character id (from @bash-fighter/content's roster) for each seat, in
   *  slot order -- parallel array to `names`. Lets every client build a
   *  local Sim with the exact same per-slot CharacterData the server used,
   *  which is load-bearing for determinism (character weight affects
   *  knockback) and for rendering the right silhouette for remote
   *  fighters. Always present and always resolved server-side (never
   *  'unknown'), so older clients that ignore it lose nothing and newer
   *  clients never need a fallback for this field specifically. */
  characterIds: string[];
}

export interface EliminatedMessage {
  t: 'eliminated';
  slot: number;
  placement: number;
  tick: number;
}

export interface MatchEndMessage {
  t: 'matchEnd';
  /** Winning slot, or null for no winner (everyone eliminated on the same
   *  tick, which a simultaneous KO can genuinely produce). */
  winner: number | null;
  /** Slots in finishing order, best first. */
  leaderboard: number[];
  tick: number;
  /** true if the sim itself decided the match (a real winner, or a
   *  genuine simultaneous-KO draw); false if every human seat left and
   *  the server tore an unfinished bot-only fight down early to stop
   *  paying for it (see isAbandonedByHumans in server/src/match.ts). An
   *  already-eliminated player should still get a real result screen
   *  when resolved is true -- only the early-teardown case is noise that
   *  has nothing to do with the match they actually played. Added
   *  2026-09-09, see wiki 'End-of-Match Screen Missing Entirely'. */
  resolved: boolean;
}

export interface ErrorMessage {
  t: 'error';
  code:
    | 'protocol_mismatch'
    | 'bad_message'
    | 'match_full'
    | 'server_error'
    | 'resume_invalid'
    | 'resume_expired'
    | 'resume_seat_taken';
  message: string;
}

export interface PingMessage {
  t: 'ping';
  id: number;
}

export type ServerControlMessage =
  | WelcomeMessage
  | LobbyMessage
  | MatchStartMessage
  | EliminatedMessage
  | MatchEndMessage
  | ErrorMessage
  | PingMessage;

// ---------------------------------------------------------------------------
// Binary: input (client -> server)
// ---------------------------------------------------------------------------

/** tag(1) + tick(4) + buttons(2) + stickX(4) + stickY(4) = 15 bytes. */
export const INPUT_FRAME_BYTES = 15;

export interface WireInput {
  /** The tick this input is intended for. Lets the server reject inputs that
   *  arrive impossibly early, and place late ones correctly. */
  tick: number;
  buttons: number;
  stickX: number;
  stickY: number;
}

export function encodeInput(input: WireInput): Uint8Array {
  const buf = new ArrayBuffer(INPUT_FRAME_BYTES);
  const view = new DataView(buf);
  view.setUint8(0, BinaryTag.INPUT);
  view.setUint32(1, input.tick >>> 0, true);
  view.setUint16(5, input.buttons & 0xffff, true);
  view.setInt32(7, input.stickX | 0, true);
  view.setInt32(11, input.stickY | 0, true);
  return new Uint8Array(buf);
}

/** Returns null for anything malformed. Callers must treat clients as hostile:
 *  a bad frame closes the connection, it never reaches the sim. */
export function decodeInput(bytes: Uint8Array): WireInput | null {
  if (bytes.byteLength !== INPUT_FRAME_BYTES) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint8(0) !== BinaryTag.INPUT) return null;
  return {
    tick: view.getUint32(1, true),
    buttons: view.getUint16(5, true),
    stickX: view.getInt32(7, true),
    stickY: view.getInt32(11, true),
  };
}

// ---------------------------------------------------------------------------
// Binary: snapshot (server -> client)
// ---------------------------------------------------------------------------

/** tag(1) + tick(4) + ackedInputTick(4) = 9 bytes, then the Int32 state words. */
export const SNAPSHOT_HEADER_BYTES = 9;

export interface WireSnapshot {
  tick: number;
  /** The most recent input tick the server has received from this client.
   *  The client uses it to discard inputs it no longer needs to re-apply. */
  ackedInputTick: number;
  state: Int32Array;
}

export function encodeSnapshot(snapshot: WireSnapshot): Uint8Array {
  const words = snapshot.state.length;
  const out = new Uint8Array(SNAPSHOT_HEADER_BYTES + words * 4);
  const view = new DataView(out.buffer);
  view.setUint8(0, BinaryTag.SNAPSHOT);
  view.setUint32(1, snapshot.tick >>> 0, true);
  view.setUint32(5, snapshot.ackedInputTick >>> 0, true);
  // Copy word by word with an explicit little-endian write rather than a
  // typed-array set: the state buffer's byte order must not depend on the
  // endianness of whichever machine the server happens to run on.
  for (let i = 0; i < words; i++) {
    view.setInt32(SNAPSHOT_HEADER_BYTES + i * 4, snapshot.state[i] as number, true);
  }
  return out;
}

export function decodeSnapshot(bytes: Uint8Array): WireSnapshot | null {
  if (bytes.byteLength < SNAPSHOT_HEADER_BYTES) return null;
  const payload = bytes.byteLength - SNAPSHOT_HEADER_BYTES;
  if (payload % 4 !== 0) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint8(0) !== BinaryTag.SNAPSHOT) return null;
  const words = payload / 4;
  const state = new Int32Array(words);
  for (let i = 0; i < words; i++) {
    state[i] = view.getInt32(SNAPSHOT_HEADER_BYTES + i * 4, true);
  }
  return {
    tick: view.getUint32(1, true),
    ackedInputTick: view.getUint32(5, true),
    state,
  };
}

// ---------------------------------------------------------------------------
// Control message parsing
// ---------------------------------------------------------------------------

/** Parse a JSON text frame from a client. Returns null for anything that is
 *  not a recognised, well-formed message. Never throws. */
export function parseClientControl(text: string): ClientControlMessage | null {
  if (text.length > 512) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof raw !== 'object' || raw === null) return null;
  const obj = raw as Record<string, unknown>;
  switch (obj.t) {
    case 'hello': {
      if (typeof obj.protocolVersion !== 'number') return null;
      if (typeof obj.name !== 'string') return null;
      const resume = typeof obj.resume === 'string' && obj.resume.length > 0 ? obj.resume : undefined;
      const characterId =
        typeof obj.characterId === 'string' && obj.characterId.length > 0 ? obj.characterId : undefined;
      return {
        t: 'hello',
        protocolVersion: obj.protocolVersion,
        name: sanitiseName(obj.name),
        ...(resume ? { resume } : {}),
        ...(characterId ? { characterId } : {}),
      };
    }
    case 'spectate':
      return { t: 'spectate' };
    case 'pong':
      if (typeof obj.id !== 'number') return null;
      return { t: 'pong', id: obj.id };
    default:
      return null;
  }
}

/** Names are shown to other players, so they are stripped of control
 *  characters and length-capped here, at the boundary, before anything else
 *  in the system sees them. */
export function sanitiseName(name: string): string {
  const cleaned = name
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, '')
    .trim()
    .slice(0, 16);
  return cleaned.length > 0 ? cleaned : 'Fighter';
}
