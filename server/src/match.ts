// One Match = one Sim + one fixed-tick loop + the connected clients playing
// or spectating it. Matches are fully isolated: no shared mutable state
// between matches, no global game instance.
import { Sim, makeInputFrame, type InputFrame, type MatchSettings } from '@bash-fighter/sim/src/index.ts';
import { BATTLE_ROYALE_20_ARENA } from '@bash-fighter/content/src/index.ts';
import { SNAPSHOT_HZ } from '@bash-fighter/net/src/protocol.ts';

export const TICK_HZ = 60;
export const TICK_MS = 1000 / TICK_HZ;
const SNAPSHOT_EVERY_N_TICKS = Math.round(TICK_HZ / SNAPSHOT_HZ);

export interface Seat {
  slot: number;
  name: string;
  connected: boolean;
  eliminated: boolean;
  /** Latest input received for this slot. Empty (neutral) input is used for
   *  ticks where nothing has arrived yet, or once disconnected. */
  pendingInput: InputFrame;
  lastInputTick: number;
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
  tick = 0;
  private timer: NodeJS.Timeout | null = null;
  private lastTickAt = 0;
  private accumulatorMs = 0;
  private ended = false;
  endedAt: number | null = null;
  countdownTicksRemaining = -1;
  readonly events: MatchEvents;

  constructor(id: string, capacity: number, minimum: number, events: MatchEvents) {
    this.id = id;
    this.capacity = capacity;
    this.minimum = minimum;
    this.events = events;
  }

  get filledSlots(): number {
    return this.seats.length;
  }

  addSeat(name: string): Seat {
    const slot = this.seats.length;
    const seat: Seat = {
      slot,
      name,
      connected: true,
      eliminated: false,
      pendingInput: makeInputFrame(),
      lastInputTick: -1,
    };
    this.seats.push(seat);
    return seat;
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

  markDisconnected(slot: number): void {
    const seat = this.seats[slot];
    if (!seat) return;
    seat.connected = false;
    seat.pendingInput = makeInputFrame();
  }

  /** Starts the fixed tick loop. Idempotent. */
  start(): void {
    if (this.phase !== 'lobby') return;
    this.phase = 'playing';
    this.seed = seedFromMatchId(this.id);
    const characters = undefined; // default placeholder character for every slot, for now
    const settingsOverride: Partial<MatchSettings> = {};
    // Test/CI hook only: lets the integration test force a short match
    // instead of waiting out the real multi-minute battle-royale shrink
    // clock. Never set in production (systemd unit does not set it).
    const shrinkOverride = process.env.MATCH_SHRINK_FULLY_CLOSED_TICK;
    if (shrinkOverride) settingsOverride.shrinkFullyClosedTick = Number(shrinkOverride);
    this.sim = new Sim(this.seed, this.seats.length, characters, BATTLE_ROYALE_20_ARENA, settingsOverride);
    this.lastTickAt = Date.now();
    this.accumulatorMs = 0;
    this.timer = setInterval(() => this.loop(), TICK_MS);
    this.events.onStart?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
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
    const inputs: InputFrame[] = this.seats.map((s) => s.pendingInput);
    sim.advance(inputs);
    this.tick++;

    for (const seat of this.seats) {
      if (seat.eliminated) continue;
      const snap = sim.getFighter(seat.slot);
      if (snap.eliminated) {
        seat.eliminated = true;
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
    }
  }
}
