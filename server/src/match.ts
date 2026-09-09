// One Match = one Sim + one fixed-tick loop + the connected clients playing
// or spectating it. Matches are fully isolated: no shared mutable state
// between matches, no global game instance.
import { randomBytes } from 'node:crypto';
import { Sim, makeInputFrame, type InputFrame, type MatchSettings } from '@bash-fighter/sim/src/index.ts';
import { BotController, BotDifficulty, deriveBotSeed, type BotDifficultyValue } from '@bash-fighter/sim/src/ai/bot.ts';
import { createMatchSim, resolveCharacterId, DEFAULT_CHARACTER_ID, pickArenaId } from '@bash-fighter/content/src/index.ts';
import { SNAPSHOT_HZ } from '@bash-fighter/net/src/protocol.ts';
import { recordTickDurationMs } from './tick-metrics.ts';

// --- Reconnection (see wiki "Netcode Design Part 3") ------------------------
// A dropped socket does not remove the fighter from the sim: it keeps being
// simulated on empty (neutral) input, exactly as before reconnection
// existed, because the sim is authoritative and does not need the client to
// keep up. What's new is that the seat stays reclaimable for a bounded grace
// window via an unguessable resume token, instead of being lost the moment
// the socket closes. A laptop sleeping, a phone switching networks, or a
// backgrounded tab is the common case for a browser game, not an edge case.
//
// Deliberately NOT implemented: bot-takeover of an abandoned seat after the
// grace window. The task brief only asks for "release the seat and
// invalidate the token" once the window expires or the fighter is
// eliminated -- it does not ask for the seat to keep playing under AI
// control afterwards, and a design that kept the token alive during a bot
// take-over would conflict with "the token no longer works" after the
// window. Simpler and matches the brief: once released, the seat just sits
// on neutral input like any other un-reclaimed disconnect, same as today.

/** How long a disconnected seat stays reclaimable via its resume token
 *  before it is released (and the token invalidated), leaving the seat
 *  simulating on empty input permanently -- same as an unreclaimed one is
 *  today. Follows the existing MATCH_* env-var pattern. */
export const RECONNECT_GRACE_MS = Number(process.env.MATCH_RECONNECT_GRACE_MS ?? 45_000);

function generateResumeToken(): string {
  // 32 bytes of crypto-grade randomness, hex-encoded: not derivable from
  // the slot number or match id, and not guessable by brute force. This is
  // the ONLY credential that can reclaim a seat -- Match.findReclaimableSeat
  // never accepts a slot number or match id as a substitute.
  return randomBytes(32).toString('hex');
}

/** MATCH_BOT_DIFFICULTY env var -> BotDifficulty, following the existing
 *  MATCH_MINIMUM / MATCH_COUNTDOWN_SECONDS env-configurable pattern.
 *  Defaults to 'medium'. Unknown values fall back to medium rather than
 *  throwing, since a typo in a systemd unit should degrade, not crash. */
function botDifficultyFromEnv(): BotDifficultyValue {
  const raw = (process.env.MATCH_BOT_DIFFICULTY ?? 'medium').toLowerCase();
  if (raw === 'easy') return BotDifficulty.EASY;
  if (raw === 'hard') return BotDifficulty.HARD;
  return BotDifficulty.MEDIUM;
}

export const TICK_HZ = 60;
export const TICK_MS = 1000 / TICK_HZ;
export const SNAPSHOT_EVERY_N_TICKS = Math.round(TICK_HZ / SNAPSHOT_HZ);

export interface Seat {
  slot: number;
  name: string;
  connected: boolean;
  eliminated: boolean;
  /** True for a server-filled AI seat (see RoomManager's bot-fill timer).
   *  A bot seat has no ClientConn/websocket, is never a broadcast watcher,
   *  and its input comes from a BotController rather than the network. */
  isBot: boolean;
  /** Requested character id (from @bash-fighter/content's roster),
   *  resolved to CharacterData when the sim is built in start(). Defaults
   *  to DEFAULT_CHARACTER_ID for bots and for any client that didn't send
   *  one -- see resolveCharacterId's fallback for unknown ids too. */
  characterId: string;
  /** Latest input received for this slot. Empty (neutral) input is used for
   *  ticks where nothing has arrived yet, or once disconnected -- unchanged
   *  from before reconnection existed. */
  pendingInput: InputFrame;
  lastInputTick: number;
  /** Opaque resume token for this seat, or null once released (and never
   *  issued for a bot seat -- there is no human to reconnect). The ONLY way
   *  to reclaim this seat is presenting this exact string back in a
   *  `hello`'s `resume` field; it is never derived from `slot` or the match
   *  id, and is invalidated (set back to null) once the grace window
   *  expires or the fighter is eliminated. */
  resumeToken: string | null;
  /** Wall-clock time (Date.now()) the seat's socket most recently closed,
   *  or null while connected. */
  disconnectedAt: number | null;
}

export type MatchPhase = 'lobby' | 'playing' | 'ended';

export interface MatchEvents {
  /** Fired when the match leaves the lobby and the sim starts. The transport
   *  layer must tell every watcher, otherwise a match started by the lobby
   *  countdown (rather than by filling every slot) begins ticking on the
   *  server while its clients sit forever on "waiting for players". */
  onStart?: () => void;
  /** Fired while the lobby is filling or counting down, so clients see a
   *  countdown that actually moves. */
  onLobbyUpdate?: () => void;
  /** Fired when a disconnected seat's grace window expires and its resume
   *  token is invalidated (releaseSeat). Otherwise a player who comes back
   *  after the grace window has nothing server-side explaining why they
   *  landed in a fresh join instead of their old seat. */
  onSeatGraceExpired?: (slot: number) => void;
  onSnapshot: (tick: number, ackedInputTick: Map<number, number>) => void;
  onEliminated: (slot: number, placement: number, tick: number) => void;
  onMatchEnd: (winner: number | null, leaderboard: number[], tick: number) => void;
}

/** Deterministic seed derived from the match id so every client can be
 *  told the same 32-bit seed without trusting Math.random on the wire. */
export function seedFromMatchId(matchId: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < matchId.length; i++) {
    h ^= matchId.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export class Match {
  readonly id: string;
  readonly capacity: number;
  readonly minimum: number;
  phase: MatchPhase = 'lobby';
  seats: Seat[] = [];
  sim: Sim | null = null;
  seed = 0;
  /** Stage this match plays on, chosen once in start() from the match
   *  seed (see pickArenaId) -- server-decided, never client-chosen, and
   *  told to every client via MatchStartMessage.arenaId so a joining or
   *  reconnecting client builds the identical Sim (see match-sim.ts). */
  arenaId = 'battle-royale-20';
  tick = 0;
  private bots = new Map<number, BotController>();
  private timer: NodeJS.Timeout | null = null;
  private lastTickAt = 0;
  private accumulatorMs = 0;
  private ended = false;
  endedAt: number | null = null;
  countdownTicksRemaining = -1;
  readonly events: MatchEvents;
  /** slot -> grace-window setTimeout that releases the seat (and its token)
   *  if it fires before a reconnect cancels it. Cleared on reconnect,
   *  elimination, match end, or stop(). */
  private graceTimers = new Map<number, NodeJS.Timeout>();

  constructor(id: string, capacity: number, minimum: number, events: MatchEvents) {
    this.id = id;
    this.capacity = capacity;
    this.minimum = minimum;
    this.events = events;
  }

  get filledSlots(): number {
    return this.seats.length;
  }

  addSeat(name: string, isBot = false, characterId: string = DEFAULT_CHARACTER_ID): Seat {
    const slot = this.seats.length;
    const seat: Seat = {
      slot,
      name,
      connected: true,
      eliminated: false,
      isBot,
      characterId,
      pendingInput: makeInputFrame(),
      lastInputTick: -1,
      resumeToken: isBot ? null : generateResumeToken(),
      disconnectedAt: null,
    };
    this.seats.push(seat);
    return seat;
  }

  /** Looks up a seat by resume token. Returns undefined for a wrong/expired/
   *  unknown token, for a bot seat (never issued one), or for a seat that is
   *  currently connected -- a live seat can never be reclaimed out from
   *  under its own player; the caller must reject the newcomer instead of
   *  kicking the incumbent. */
  findReclaimableSeat(token: string): Seat | undefined {
    const seat = this.seats.find((s) => s.resumeToken !== null && s.resumeToken === token && !s.connected);
    if (!seat) return undefined;
    // The grace-window setTimeout in markDisconnected is the seat's primary
    // expiry mechanism, but a JS timer is only guaranteed to fire no
    // earlier than its delay -- under event-loop load it can fire
    // arbitrarily later. Trusting resumeToken !== null alone therefore lets
    // a token that is already past its grace window still be honoured if
    // the timer callback simply hasn't run yet. Re-check elapsed wall-clock
    // time here so expiry is correct regardless of scheduler lag, and
    // self-heal by releasing the seat immediately if it is found stale.
    if (seat.disconnectedAt !== null && Date.now() - seat.disconnectedAt >= RECONNECT_GRACE_MS) {
      this.releaseSeat(seat.slot, true);
      return undefined;
    }
    return seat;
  }

  /** Finds a seat by token regardless of connected state, purely so the
   *  transport layer can tell "unknown/expired token" apart from "valid
   *  token, but that seat already has a live connection" (a duplicate
   *  connection racing the original) for a more honest error message.
   *  Excludes seats whose grace window has elapsed even if the release
   *  timer hasn't fired yet, for the same reason as findReclaimableSeat. */
  findSeatByAnyToken(token: string): Seat | undefined {
    const seat = this.seats.find((s) => s.resumeToken !== null && s.resumeToken === token);
    if (!seat) return undefined;
    if (!seat.connected && seat.disconnectedAt !== null && Date.now() - seat.disconnectedAt >= RECONNECT_GRACE_MS) {
      this.releaseSeat(seat.slot, true);
      return undefined;
    }
    return seat;
  }

  /** Reclaims a disconnected seat for a new connection: cancels its grace
   *  timer and marks it connected again. The caller (transport layer) is
   *  responsible for wiring the new socket to this slot and does not need
   *  to touch pendingInput -- it already holds neutral input from
   *  markDisconnected and the client will send fresh input immediately.
   *  Returns false if the seat is not in a reclaimable state; defensive,
   *  callers are expected to have gone through findReclaimableSeat first. */
  reclaimSeat(slot: number): boolean {
    const seat = this.seats[slot];
    if (!seat || seat.connected || seat.resumeToken === null) return false;
    seat.connected = true;
    seat.disconnectedAt = null;
    this.clearGraceTimer(slot);
    return true;
  }

  private clearGraceTimer(slot: number): void {
    const t = this.graceTimers.get(slot);
    if (t) clearTimeout(t);
    this.graceTimers.delete(slot);
  }

  /** Ends a seat's reclaimability: invalidates its token so a stale/used
   *  token can never succeed again. Does not touch the sim -- the seat
   *  keeps simulating on whatever input it already has (neutral, since
   *  markDisconnected zeroed it). Idempotent. */
  private releaseSeat(slot: number, viaGraceExpiry = false): void {
    this.clearGraceTimer(slot);
    const seat = this.seats[slot];
    if (!seat) return;
    const wasReclaimable = seat.resumeToken !== null;
    seat.resumeToken = null;
    if (viaGraceExpiry && wasReclaimable) this.events.onSeatGraceExpired?.(slot);
  }

  setInput(slot: number, input: InputFrame, tick: number): void {
    const seat = this.seats[slot];
    if (!seat || seat.eliminated) return;
    // Reject inputs far in the future/past: a hostile client could otherwise
    // send garbage tick numbers to confuse reconciliation on other clients'
    // logs, though the server sim itself never trusts the client tick for
    // anything beyond bookkeeping (it always applies the latest input on
    // its own next tick regardless of what tick the client claims).
    if (tick < 0) return;
    seat.pendingInput = input;
    seat.lastInputTick = Math.max(seat.lastInputTick, tick);
  }

  /** Called by the transport layer when a seat's socket closes. The fighter
   *  keeps being simulated on empty input, same as before reconnection
   *  existed -- what's new is starting the grace window during which the
   *  seat's resume token can reclaim it. No timer is started for a bot
   *  seat, an already-released seat, or once the match has ended: there is
   *  nothing to reclaim in any of those cases. */
  markDisconnected(slot: number): void {
    const seat = this.seats[slot];
    if (!seat) return;
    seat.connected = false;
    seat.pendingInput = makeInputFrame();
    seat.disconnectedAt = Date.now();
    this.clearGraceTimer(slot);
    if (seat.isBot || seat.eliminated || seat.resumeToken === null || this.phase === 'ended') return;
    const timer = setTimeout(() => this.releaseSeat(slot, true), RECONNECT_GRACE_MS);
    // Never keep the process alive just for this timer (tests spawn many
    // short-lived matches; production always has the tick-loop timer/http
    // server keeping it alive regardless).
    timer.unref?.();
    this.graceTimers.set(slot, timer);
  }

  /** Starts the fixed tick loop. Idempotent. */
  start(): void {
    if (this.phase !== 'lobby') return;
    this.phase = 'playing';
    this.seed = seedFromMatchId(this.id);
    // Seeded, not wall-clock-rotated: two matches created in the same
    // second must not collide, and a match must be able to replay
    // identically from its recorded seed (see pickArenaId's comment).
    this.arenaId = pickArenaId(this.seed);
    // Per-seat character, resolved from each seat's requested id (see
    // Seat.characterId's comment for the bot/unset/unknown-id fallback).
    const characters = this.seats.map((seat) => resolveCharacterId(seat.characterId));
    const settingsOverride: Partial<MatchSettings> = {};
    // Test/CI hook only: lets the integration test force a short match
    // instead of waiting out the real multi-minute battle-royale shrink
    // clock. Never set in production (systemd unit does not set it).
    const shrinkOverride = process.env.MATCH_SHRINK_FULLY_CLOSED_TICK;
    if (shrinkOverride) settingsOverride.shrinkFullyClosedTick = Number(shrinkOverride);
    this.sim = createMatchSim(this.seed, this.seats.length, settingsOverride, characters, this.arenaId);
    const difficulty = botDifficultyFromEnv();
    // Human (non-bot) seats, passed to every bot so EASY's anti-dogpile
    // tuning (protectedTargetPenalty/protectedClusterMultiplier in
    // packages/sim/src/ai/bot.ts) knows which fighters are real players.
    // No-op at MEDIUM/HARD, where those tuning values are 0.
    const humanSlots = new Set(this.seats.filter((s) => !s.isBot).map((s) => s.slot));
    this.bots.clear();
    for (const seat of this.seats) {
      if (seat.isBot) {
        this.bots.set(seat.slot, new BotController(seat.slot, difficulty, deriveBotSeed(this.seed, seat.slot), humanSlots));
      }
    }
    this.lastTickAt = Date.now();
    this.accumulatorMs = 0;
    this.timer = setInterval(() => this.loop(), TICK_MS);
    this.events.onStart?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    // Cancel pending grace-release timers -- there's no sim ticking any
    // more so "release into the sim" is moot -- but deliberately do NOT
    // invalidate the tokens themselves here. A player who disconnects just
    // before the match ends (and was never eliminated) should still be able
    // to reconnect briefly afterwards and be told the outcome (edge case:
    // reconnect-after-match-end) rather than getting a cold rejection. Those
    // tokens go away naturally once RoomManager.reap() drops this whole
    // Match object -- there is nothing left holding a reference to them.
    for (const t of this.graceTimers.values()) clearTimeout(t);
    this.graceTimers.clear();
  }

  private loop(): void {
    const now = Date.now();
    let elapsed = now - this.lastTickAt;
    this.lastTickAt = now;
    // Cap how much wall-clock catch-up a single call does, so a stalled
    // event loop (GC pause, or the process being suspended) cannot make the
    // sim try to run hundreds of ticks in one burst.
    if (elapsed > 250) elapsed = 250;
    this.accumulatorMs += elapsed;
    while (this.accumulatorMs >= TICK_MS && this.phase === 'playing') {
      this.accumulatorMs -= TICK_MS;
      this.tickOnce();
    }
  }

  private tickOnce(): void {
    const sim = this.sim;
    if (!sim) return;
    const inputs: InputFrame[] = this.seats.map((s) => {
      const bot = this.bots.get(s.slot);
      return bot ? bot.nextInput(sim) : s.pendingInput;
    });
    const tickStart = process.hrtime.bigint();
    sim.advance(inputs);
    recordTickDurationMs(Number(process.hrtime.bigint() - tickStart) / 1e6);
    this.tick++;

    for (const seat of this.seats) {
      if (seat.eliminated) continue;
      const snap = sim.getFighter(seat.slot);
      if (snap.eliminated) {
        seat.eliminated = true;
        // Elimination ends reclaimability too (brief item 2): there is no
        // fighter left to hand back control of.
        this.releaseSeat(seat.slot);
        this.events.onEliminated(seat.slot, snap.placement, this.tick);
      }
    }

    if (this.tick % SNAPSHOT_EVERY_N_TICKS === 0) {
      const acked = new Map<number, number>();
      for (const seat of this.seats) acked.set(seat.slot, seat.lastInputTick);
      this.events.onSnapshot(this.tick, acked);
    }

    if (!this.ended && sim.isMatchOver()) {
      this.ended = true;
      this.phase = 'ended';
      this.events.onMatchEnd(sim.getWinner(), sim.getLeaderboard(), this.tick);
      this.endedAt = Date.now();
      this.stop();
      return;
    }

    // A match every human left behind (all disconnected past their grace
    // window, or eliminated) has nobody who could ever come back to it --
    // only bots are left steering it, if anyone. Left running, it keeps
    // ticking a full sim (CPU, memory, one entry in matchCount) for as
    // long as the bots take to fight it out, which is the multi-minute
    // real match length -- not a leak exactly, but a real waste and a
    // false read on server capacity while it lasts. End it now instead of
    // waiting that out.
    if (!this.ended && this.isAbandonedByHumans()) {
      this.ended = true;
      this.phase = 'ended';
      this.events.onMatchEnd(sim.getWinner(), sim.getLeaderboard(), this.tick);
      this.endedAt = Date.now();
      this.stop();
    }
  }

  /** True once every human seat is unreachable: eliminated, or
   *  disconnected with its resume token already gone (grace expired or
   *  never reclaimable). A match with zero human seats to begin with is
   *  deliberately NOT treated as abandoned here; that would end a match
   *  before it had a chance to matter, and shouldn't happen anyway since
   *  bots only ever fill an already-human-started lobby. */
  private isAbandonedByHumans(): boolean {
    const humanSeats = this.seats.filter((s) => !s.isBot);
    if (humanSeats.length === 0) return false;
    return humanSeats.every((s) => s.eliminated || (!s.connected && s.resumeToken === null));
  }
}
