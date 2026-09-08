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
import type { Match } from './match.ts';

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

function closeWithError(conn: ClientConn, code: 'protocol_mismatch' | 'bad_message' | 'match_full' | 'server_error', message: string): void {
  send(conn, { t: 'error', code, message });
  conn.ws.close();
}

function watcherSet(matchId: string): Set<string> {
  let s = watchers.get(matchId);
  if (!s) {
    s = new Set();
    watchers.set(matchId, s);
  }
  return s;
}

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
      arenaId: 'battle-royale-20',
      names: match.seats.map((s) => s.name),
    });
  }
}

function makeEventsFor(matchId: string) {
  return {
    onSnapshot(tick: number, acked: Map<number, number>) {
      const match = manager.getMatch(matchId);
      if (!match || !match.sim) return;
      const buf = match.sim.createStateBuffer();
      match.sim.saveState(buf);
      for (const cid of watcherSet(matchId)) {
        const c = clients.get(cid);
        if (!c) continue;
        const ackedInputTick = c.spectating ? 0 : acked.get(c.slot) ?? 0;
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

  ws.on('close', () => {
    if (conn.match) {
      conn.match.markDisconnected(conn.slot);
      watcherSet(conn.match.id).delete(conn.id);
    }
    clients.delete(conn.id);
  });

  ws.on('error', () => {
    ws.close();
  });
});

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
      const name = sanitiseName(msg.name);
      const { match, slot } = manager.joinLobby(name);
      conn.match = match;
      conn.slot = slot;
      watcherSet(match.id).add(conn.id);
      send(conn, { t: 'welcome', protocolVersion: PROTOCOL_VERSION, clientId: conn.id, slot, matchId: match.id });
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

const PORT = Number(process.env.PORT ?? 8081);
server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`bash-fighter server listening on :${PORT} (capacity=${manager.capacity}, minimum=${manager.minimum})`);
});
