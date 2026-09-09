// Bash Fighter authoritative match server. Server-owned deterministic sim,
// one per match; clients only send inputs and receive snapshots. See
// docs/PROTOCOL.md for the wire format.
//
// Module-level state (clients/watchers/manager) is fine here: one process
// runs one server. Tests that want an isolated instance run this in a
// child process or import createBashFighterServer, which is exercised by
// server/test/integration.test.ts via a spawned child process so multiple
// test runs never share this module's state.
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import {
  PROTOCOL_VERSION,
  parseClientControl,
  decodeInput,
  encodeSnapshot,
  sanitiseName,
  type ServerControlMessage,
  type WireSnapshot,
} from '@bash-fighter/net/src/protocol.ts';
import { RoomManager, DEFAULT_CAPACITY, DEFAULT_MINIMUM } from './rooms.ts';
import { tickMetricsSnapshot } from './tick-metrics.ts';
import { SNAPSHOT_EVERY_N_TICKS, type Match } from './match.ts';

export interface ServerOptions {
  port?: number;
  capacity?: number;
  minimum?: number;
}

interface ClientConn {
  id: string;
  ws: WebSocket;
  match: Match | null;
  slot: number; // -1 = pure spectator / not yet assigned
  spectating: boolean;
  helloed: boolean;
}

const clients = new Map<string, ClientConn>();
// matchId -> set of client ids watching it (players + spectators)
const watchers = new Map<string, Set<string>>();

function send(conn: ClientConn, msg: ServerControlMessage): void {
  if (conn.ws.readyState !== WebSocket.OPEN) return;
  conn.ws.send(JSON.stringify(msg));
}

function sendBinary(conn: ClientConn, bytes: Uint8Array): void {
  if (conn.ws.readyState !== WebSocket.OPEN) return;
  conn.ws.send(bytes);
}

function closeWithError(
  conn: ClientConn,
  code: 'protocol_mismatch' | 'bad_message' | 'match_full' | 'server_error' | 'resume_invalid' | 'resume_expired' | 'resume_seat_taken',
  message: string,
): void {
  logConn(conn, 'error_close', { code, message });
  send(conn, { t: 'error', code, message });
  conn.ws.close();
}

// Structured, single-line connection-lifecycle logging -- deliberately not
// a logging framework, just enough (timestamp, conn id, slot/match if
// known, event, extra fields) that a production drop or a resume-that-
// didn't-work is diagnosable from `journalctl`/systemd logs rather than
// invisible. See wiki "First-Match Experience Problem" for why this was
// missing before: the only way to know a disconnect happened was the
// player noticing themselves.
// LOG_LEVEL controls verbosity without a logging framework: 'silent'
// disables all [conn]/[summary] lines (e.g. for a busy test run), 'info'
// (default) is every lifecycle event below plus the periodic summary --
// there is deliberately no per-tick or per-frame level, because that
// firehose is exactly what would cost CPU and fill the disk.
const LOG_LEVEL = (process.env.LOG_LEVEL ?? 'info').toLowerCase();
const LOGGING_ENABLED = LOG_LEVEL !== 'silent';

function logConn(conn: ClientConn, event: string, extra?: Record<string, unknown>): void {
  if (!LOGGING_ENABLED) return;
  const line = {
    ts: new Date().toISOString(),
    connId: conn.id,
    matchId: conn.match?.id ?? null,
    slot: conn.slot,
    event,
    ...extra,
  };
  console.log(`[conn] ${JSON.stringify(line)}`);
}

function watcherSet(matchId: string): Set<string> {
  let s = watchers.get(matchId);
  if (!s) {
    s = new Set();
    watchers.set(matchId, s);
  }
  return s;
}

// A connection counts as a live player only while it holds an un-eliminated
// seat and never opted into pure spectating. Everyone else -- pre-join
// sockets (slot -1), explicit spectators, and eliminated fighters whose
// seat keeps ticking in the sim on neutral input -- gets the reduced
// spectator stream below. Re-derived from match/seat state on every
// snapshot rather than cached on ClientConn, since elimination flips a
// seat from live to spectator mid-match with no separate event needed here.
function isSpectatorConn(conn: ClientConn, match: Match): boolean {
  if (conn.spectating || conn.slot < 0) return true;
  const seat = match.seats[conn.slot];
  return !seat || seat.eliminated;
}

// Snapshot rate for spectator connections, as a divisor of the live 20Hz
// rate (SNAPSHOT_HZ in packages/net/src/protocol.ts). 2 -> 10Hz.
//
// Why 10Hz and not lower: per wiki "Netplay Chaos Part 1", a 20-player
// match spends most of its connected-client-seconds with few fighters left
// and many spectators (a Last-Fighter-Standing match ends 19/20
// eliminated), so spectator egress dominates total server egress for most
// of a match's duration even though spectators need less fidelity than a
// live player reconciling their own position. Halving the rate halves
// spectator egress (~68 KB/s -> ~35 KB/s per the wiki's own 10Hz number)
// while staying comfortably above the ~5-8Hz floor where platform-fighter
// motion starts to visibly step even with interpolation (short, fast
// hops/dashes need enough samples to look continuous). 4x (5Hz) was
// measured to look noticeably steppier during visual verification (see
// commit message / final report) with the same interpolation code, so 2x
// is the number actually shipped, not just estimated.
const SPECTATOR_SNAPSHOT_DIVISOR = 2;

function broadcastLobby(match: Match): void {
  const msg: ServerControlMessage = {
    t: 'lobby',
    players: match.filledSlots,
    capacity: match.capacity,
    minimum: match.minimum,
    countdownTicks: match.countdownTicksRemaining,
    names: match.seats.map((s) => s.name),
  };
  for (const cid of watcherSet(match.id)) {
    const c = clients.get(cid);
    if (c) send(c, msg);
  }
}

function broadcastMatchStart(match: Match): void {
  for (const cid of watcherSet(match.id)) {
    const c = clients.get(cid);
    if (!c) continue;
    send(c, {
      t: 'matchStart',
      matchId: match.id,
      seed: match.seed,
      numFighters: match.seats.length,
      slot: c.spectating ? -1 : c.slot,
      settings: {},
      arenaId: match.arenaId,
      names: match.seats.map((s) => s.name),
      characterIds: match.seats.map((s) => s.characterId),
    });
  }
}

function makeEventsFor(matchId: string) {
  return {
    onStart() {
      const match = manager.getMatch(matchId);
      if (match) broadcastMatchStart(match);
    },
    onLobbyUpdate() {
      const match = manager.getMatch(matchId);
      if (match && match.phase === 'lobby') broadcastLobby(match);
    },
    onSeatGraceExpired(slot: number) {
      if (!LOGGING_ENABLED) return;
      const line = {
        ts: new Date().toISOString(),
        connId: null,
        matchId,
        slot,
        event: 'seat_grace_expired',
      };
      console.log(`[conn] ${JSON.stringify(line)}`);
    },
    onSnapshot(tick: number, acked: Map<number, number>) {
      const match = manager.getMatch(matchId);
      if (!match || !match.sim) return;
      const buf = match.sim.createStateBuffer();
      match.sim.saveState(buf);
      // This callback already only fires once per SNAPSHOT_EVERY_N_TICKS
      // (20Hz) -- skip alternate firings for spectator connections to land
      // on ~10Hz for them (SPECTATOR_SNAPSHOT_DIVISOR), without touching
      // the 60Hz sim tick or the live-player rate at all.
      const sendToSpectatorsThisTick = (tick / SNAPSHOT_EVERY_N_TICKS) % SPECTATOR_SNAPSHOT_DIVISOR === 0;
      for (const cid of watcherSet(matchId)) {
        const c = clients.get(cid);
        if (!c) continue;
        const spectator = isSpectatorConn(c, match);
        if (spectator && !sendToSpectatorsThisTick) continue;
        // ackedInputTick only means anything to a client replaying its own
        // buffered inputs during reconciliation (packages/app's
        // net-match.ts); a spectator/eliminated connection never predicts
        // or reconciles a fighter of its own, so it's dead weight -- always
        // 0 for them rather than a per-slot lookup that has no meaning for
        // that connection.
        const ackedInputTick = spectator ? 0 : acked.get(c.slot) ?? 0;
        const snap: WireSnapshot = { tick, ackedInputTick, state: buf };
        sendBinary(c, encodeSnapshot(snap));
      }
    },
    onEliminated(slot: number, placement: number, tick: number) {
      const msg: ServerControlMessage = { t: 'eliminated', slot, placement, tick };
      for (const cid of watcherSet(matchId)) {
        const c = clients.get(cid);
        if (c) send(c, msg);
      }
    },
    onMatchEnd(winner: number | null, leaderboard: number[], tick: number) {
      const msg: ServerControlMessage = { t: 'matchEnd', winner, leaderboard, tick };
      for (const cid of watcherSet(matchId)) {
        const c = clients.get(cid);
        if (c) send(c, msg);
      }
    },
  };
}

const CAPACITY = Number(process.env.MATCH_CAPACITY ?? DEFAULT_CAPACITY);
const MINIMUM = Number(process.env.MATCH_MINIMUM ?? DEFAULT_MINIMUM);
const manager = new RoomManager(makeEventsFor, CAPACITY, MINIMUM);

const server = http.createServer((req, res) => {
  if (req.url === '/api/metrics') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(tickMetricsSnapshot()));
    return;
  }
  if (req.url === '/api/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        status: 'ok',
        uptimeSeconds: process.uptime(),
        matchCount: manager.matchCount,
        playerCount: manager.playerCount,
      }),
    );
    return;
  }
  res.writeHead(404, { 'content-type': 'text/plain' });
  res.end('not found');
});

const wss = new WebSocketServer({ server, path: '/socket' });

wss.on('connection', (ws) => {
  const conn: ClientConn = {
    id: randomUUID(),
    ws,
    match: null,
    slot: -1,
    spectating: false,
    helloed: false,
  };
  clients.set(conn.id, conn);
  logConn(conn, 'connected');

  ws.on('message', (data, isBinary) => {
    try {
      if (isBinary) {
        handleBinary(conn, data as Buffer);
      } else {
        handleText(conn, data.toString('utf8'));
      }
    } catch {
      // A hostile or buggy client must never take the process down.
      closeWithError(conn, 'server_error', 'internal error handling message');
    }
  });

  ws.on('close', (code, reason) => {
    // Close code + reason are the single most useful fact for telling a
    // client-dropped-it disconnect (1001/1006, no reason) apart from a
    // server-initiated close (closeWithError always sets a reason string).
    // Never anything sensitive here -- code is a number, reason is a short
    // protocol string, never a token or IP.
    const closeInfo = { code, reason: reason.toString('utf8').slice(0, 120) || null };
    // A spectator or not-yet-assigned socket has no seat to hold open; only
    // a real fighter slot gets the disconnect/grace-period treatment.
    const hadLiveSeat = conn.match && !conn.spectating && conn.slot >= 0;
    if (hadLiveSeat && conn.match) {
      conn.match.markDisconnected(conn.slot);
      logConn(conn, 'seat_disconnected', { gracePeriod: true, ...closeInfo });
    } else {
      logConn(conn, 'closed', { hadSeat: false, ...closeInfo });
    }
    if (conn.match) watcherSet(conn.match.id).delete(conn.id);
    clients.delete(conn.id);
  });

  ws.on('error', (err) => {
    logConn(conn, 'socket_error', { message: err instanceof Error ? err.message : String(err) });
    ws.close();
  });
});

/** Handles a `hello` that carries a `resume` token instead of joining a
 *  fresh lobby. Presenting a token is the ONLY path that can hand a
 *  connection someone else's seat -- there is no lookup by matchId+slot
 *  alone -- and a wrong/expired/already-connected token always fails with
 *  an explicit `error` frame rather than silently falling back to a new
 *  join, so a client bug can't accidentally end up spectating or dropped
 *  into a random lobby without knowing why. */
function handleResume(conn: ClientConn, token: string): void {
  const found = manager.findReclaim(token);
  if (!found) {
    if (manager.isTokenForConnectedSeat(token)) {
      // Valid token, but that seat already has a live socket -- reject the
      // newcomer, never kick the incumbent.
      logConn(conn, 'resume_rejected', { reason: 'resume_seat_taken' });
      closeWithError(conn, 'resume_seat_taken', 'this seat already has an active connection');
    } else {
      logConn(conn, 'resume_rejected', { reason: 'resume_invalid' });
      closeWithError(conn, 'resume_invalid', 'resume token not recognised or expired');
    }
    return;
  }
  const { match, slot } = found;
  const seat = match.seats[slot];

  if (match.phase === 'ended') {
    logConn(conn, 'resume_after_match_ended', { matchId: match.id, slot });
    // Told the outcome instead of erroring (edge case: reconnect after the
    // match already ended). The seat is not re-marked connected -- there is
    // no sim ticking any more to reconnect *to* -- this is purely informing
    // the client so it can show a result screen instead of hanging.
    conn.match = match;
    conn.slot = slot;
    watcherSet(match.id).add(conn.id);
    send(conn, {
      t: 'welcome',
      protocolVersion: PROTOCOL_VERSION,
      clientId: conn.id,
      slot,
      matchId: match.id,
      resumeToken: null,
      resumed: true,
    });
    const sim = match.sim;
    send(conn, {
      t: 'matchEnd',
      winner: sim ? sim.getWinner() : null,
      leaderboard: sim ? sim.getLeaderboard() : [],
      tick: match.tick,
    });
    return;
  }

  if (!match.reclaimSeat(slot)) {
    // Lost a race (e.g. grace timer fired between findReclaim and here, or
    // someone else's connection beat us to it) -- fail cleanly rather than
    // handing over a seat that is no longer actually reclaimable.
    logConn(conn, 'resume_rejected', { reason: 'resume_expired', matchId: match.id, slot });
    closeWithError(conn, 'resume_expired', 'seat is no longer reclaimable');
    return;
  }

  conn.match = match;
  conn.slot = slot;
  watcherSet(match.id).add(conn.id);
  logConn(conn, 'resume_succeeded');
  send(conn, {
    t: 'welcome',
    protocolVersion: PROTOCOL_VERSION,
    clientId: conn.id,
    slot,
    matchId: match.id,
    resumeToken: seat.resumeToken,
    resumed: true,
  });
  // Re-tell the reconnecting client the match parameters (seed, arena,
  // names) so it can rebuild its sim from scratch rather than trusting any
  // stale client-side state -- it will resync from the very next
  // authoritative snapshot regardless.
  send(conn, {
    t: 'matchStart',
    matchId: match.id,
    seed: match.seed,
    numFighters: match.seats.length,
    slot,
    settings: {},
    arenaId: match.arenaId,
    names: match.seats.map((s) => s.name),
    characterIds: match.seats.map((s) => s.characterId),
  });
}

function handleText(conn: ClientConn, text: string): void {
  const msg = parseClientControl(text);
  if (!msg) {
    closeWithError(conn, 'bad_message', 'malformed control message');
    return;
  }
  switch (msg.t) {
    case 'hello': {
      if (msg.protocolVersion !== PROTOCOL_VERSION) {
        closeWithError(
          conn,
          'protocol_mismatch',
          `server protocol ${PROTOCOL_VERSION}, client sent ${msg.protocolVersion}`,
        );
        return;
      }
      if (conn.helloed) return; // ignore duplicate hello
      conn.helloed = true;

      if (msg.resume) {
        handleResume(conn, msg.resume);
        return;
      }

      const name = sanitiseName(msg.name);
      const { match, slot } = manager.joinLobby(name, msg.characterId);
      conn.match = match;
      conn.slot = slot;
      watcherSet(match.id).add(conn.id);
      logConn(conn, 'joined_lobby', { name });
      send(conn, {
        t: 'welcome',
        protocolVersion: PROTOCOL_VERSION,
        clientId: conn.id,
        slot,
        matchId: match.id,
        resumeToken: match.seats[slot].resumeToken,
        resumed: false,
      });
      if (match.phase === 'lobby') {
        broadcastLobby(match);
      } else {
        broadcastMatchStart(match);
      }
      break;
    }
    case 'spectate': {
      conn.spectating = true;
      break;
    }
    case 'pong': {
      // Round-trip measurement hook; nothing to do server-side yet.
      break;
    }
  }
}

function handleBinary(conn: ClientConn, data: Buffer): void {
  const input = decodeInput(new Uint8Array(data));
  if (!input) return; // malformed input frame: drop it, don't crash or close
  if (!conn.match || conn.spectating || conn.slot < 0) return;
  conn.match.setInput(conn.slot, { buttons: input.buttons, stickX: input.stickX, stickY: input.stickY }, input.tick);
}

setInterval(() => manager.reap(), 30_000).unref();

// Periodic one-line health summary, only when there's something to say --
// an idle server (no connections, no matches) stays silent rather than
// printing a heartbeat every 30s forever. Bots count separately from real
// players so a log reader can tell a bot-filled lobby from a real crowd.
setInterval(() => {
  if (!LOGGING_ENABLED) return;
  const connectionCount = clients.size;
  const matchCount = manager.matchCount;
  const playerCount = manager.playerCount;
  const botCount = manager.botCount;
  if (connectionCount === 0 && matchCount === 0) return; // idle: stay silent
  console.log(
    `[summary] ${JSON.stringify({
      ts: new Date().toISOString(),
      connections: connectionCount,
      matches: matchCount,
      players: playerCount,
      bots: botCount,
    })}`,
  );
}, 30_000).unref();

const PORT = Number(process.env.PORT ?? 8081);
server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`bash-fighter server listening on :${PORT} (capacity=${manager.capacity}, minimum=${manager.minimum})`);
});
