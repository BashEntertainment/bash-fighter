// Lobby/room manager: assigns connecting clients to a filling match, starts
// matches, and garbage-collects ended ones. Many independent Match objects;
// this class never runs a sim itself.
import { Match, TICK_HZ, type MatchEvents } from './match.ts';

export const DEFAULT_CAPACITY = 20;
export const DEFAULT_MINIMUM = 2;
export const COUNTDOWN_SECONDS = Number(process.env.MATCH_COUNTDOWN_SECONDS ?? 15);

export class RoomManager {
  private matches = new Map<string, Match>();
  private filling: Match | null = null;
  private nextId = 1;
  private countdownTimer: NodeJS.Timeout | null = null;
  readonly capacity: number;
  readonly minimum: number;
  private readonly makeEvents: (matchId: string) => MatchEvents;

  constructor(makeEvents: (matchId: string) => MatchEvents, capacity = DEFAULT_CAPACITY, minimum = DEFAULT_MINIMUM) {
    this.makeEvents = makeEvents;
    this.capacity = capacity;
    this.minimum = minimum;
  }

  get matchCount(): number {
    return this.matches.size;
  }

  get playerCount(): number {
    let n = 0;
    for (const m of this.matches.values()) n += m.seats.filter((s) => s.connected).length;
    return n;
  }

  getMatch(id: string): Match | undefined {
    return this.matches.get(id);
  }

  /** Finds or creates the match currently filling, adds a seat to it, and
   *  returns both. Starting the match (full, or countdown reaching zero) is
   *  handled here too so callers don't need to poll. */
  joinLobby(name: string): { match: Match; slot: number } {
    if (!this.filling || this.filling.phase !== 'lobby') {
      const id = `m${this.nextId++}`;
      const match = new Match(id, this.capacity, this.minimum, this.makeEvents(id));
      this.matches.set(id, match);
      this.filling = match;
    }
    const match = this.filling;
    const seat = match.addSeat(name);

    if (match.filledSlots >= match.capacity) {
      this.clearCountdown();
      match.start();
      this.filling = null;
    } else if (match.filledSlots >= match.minimum && !this.countdownTimer) {
      this.startCountdown(match);
    }
    return { match, slot: seat.slot };
  }

  private startCountdown(match: Match): void {
    let ticksLeft = COUNTDOWN_SECONDS * TICK_HZ;
    match.countdownTicksRemaining = ticksLeft;
    this.countdownTimer = setInterval(() => {
      ticksLeft -= TICK_HZ / 5;
      match.countdownTicksRemaining = Math.max(0, ticksLeft);
      match.events.onLobbyUpdate?.();
      if (ticksLeft <= 0) {
        this.clearCountdown();
        if (match.phase === 'lobby') {
          match.start();
          if (this.filling === match) this.filling = null;
        }
      }
    }, 200);
  }

  private clearCountdown(): void {
    if (this.countdownTimer) clearInterval(this.countdownTimer);
    this.countdownTimer = null;
  }

  /** Drop matches that ended a while ago, so memory doesn't grow forever. */
  reap(maxAgeMs = 60_000): void {
    const now = Date.now();
    for (const [id, m] of this.matches) {
      if (m.phase === 'ended' && m.endedAt !== null && now - m.endedAt > maxAgeMs) {
        this.matches.delete(id);
      }
    }
  }
}
