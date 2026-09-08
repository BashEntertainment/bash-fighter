// Lobby/room manager: assigns connecting clients to a filling match, starts
// matches, and garbage-collects ended ones. Many independent Match objects;
// this class never runs a sim itself.
import { Match, TICK_HZ, type MatchEvents } from './match.ts';
import { botName } from '@bash-fighter/sim/src/ai/bot.ts';

export const DEFAULT_CAPACITY = 20;
export const DEFAULT_MINIMUM = 2;
export const COUNTDOWN_SECONDS = Number(process.env.MATCH_COUNTDOWN_SECONDS ?? 15);
// A 20-stranger lobby that needs 20 simultaneous humans to ever start is
// how a launch dies quietly: the first visitor waits in an empty room and
// leaves. So once *some* players are in, wait a short while for more real
// humans, then fill the rest of the lobby with bots and start anyway —
// "nobody else is here" becomes "a full chaotic match starts in a few
// seconds" instead of an indefinite wait. Configurable like
// MATCH_COUNTDOWN_SECONDS so ops/tests can tune or disable it
// (MATCH_BOT_FILL_SECONDS=0 fills immediately; a very large value
// effectively disables bot-filling).
export const BOT_FILL_SECONDS = Number(process.env.MATCH_BOT_FILL_SECONDS ?? 8);
// How many total seats (human + bot) a bot-filled match should start with.
// Defaults to full capacity: fill the whole 20-slot battle royale so one
// early player still gets the intended chaotic-FFA experience.
export const BOT_FILL_TARGET = Number(process.env.MATCH_BOT_FILL_TARGET ?? DEFAULT_CAPACITY);

export class RoomManager {
  private matches = new Map<string, Match>();
  private filling: Match | null = null;
  private nextId = 1;
  private countdownTimer: NodeJS.Timeout | null = null;
  private botFillTimer: NodeJS.Timeout | null = null;
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
    // Bots are never real connected clients (no websocket, no snapshots
    // sent to them) — exclude them so this reflects actual player load.
    for (const m of this.matches.values()) n += m.seats.filter((s) => s.connected && !s.isBot).length;
    return n;
  }

  getMatch(id: string): Match | undefined {
    return this.matches.get(id);
  }

  /** Finds the match/seat a resume token reclaims, across every match this
   *  manager still knows about (a client does not know its old matchId is
   *  still needed, so it just presents the token). Not indexed separately
   *  by token: match/seat counts are small (capacity 20, matchCount bounded
   *  by reap()) and this only runs on the rare reconnect path, not the hot
   *  60Hz tick path. */
  findReclaim(token: string): { match: Match; slot: number } | undefined {
    for (const match of this.matches.values()) {
      const seat = match.findReclaimableSeat(token);
      if (seat) return { match, slot: seat.slot };
    }
    return undefined;
  }

  /** True if `token` belongs to a seat that is valid but currently
   *  connected (a duplicate/racing connection), as opposed to simply
   *  unknown or expired. Used only to choose the more honest error code. */
  isTokenForConnectedSeat(token: string): boolean {
    for (const match of this.matches.values()) {
      if (match.findSeatByAnyToken(token)) return true;
    }
    return false;
  }

  /** Finds or creates the match currently filling, adds a seat to it, and
   *  returns both. Starting the match (full, or countdown reaching zero) is
   *  handled here too so callers don't need to poll. */
  joinLobby(name: string): { match: Match; slot: number } {
    let freshMatch = false;
    if (!this.filling || this.filling.phase !== 'lobby') {
      const id = `m${this.nextId++}`;
      const match = new Match(id, this.capacity, this.minimum, this.makeEvents(id));
      this.matches.set(id, match);
      this.filling = match;
      freshMatch = true;
    }
    const match = this.filling;
    const seat = match.addSeat(name);
    if (freshMatch) this.startBotFillTimer(match);

    if (match.filledSlots >= match.capacity) {
      this.clearCountdown();
      this.clearBotFillTimer();
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
        this.clearBotFillTimer();
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

  /** Started once per newly-created lobby. If nobody else has joined by
   *  the time it fires and the lobby is still open, fills every remaining
   *  slot (up to BOT_FILL_TARGET) with bots and starts immediately —
   *  a human alone in a 20-slot lobby should not have to wait for 19
   *  strangers, or wait at all beyond this short grace period. */
  private startBotFillTimer(match: Match): void {
    this.clearBotFillTimer();
    this.botFillTimer = setTimeout(() => {
      this.botFillTimer = null;
      if (match.phase !== 'lobby') return;
      const target = Math.min(match.capacity, Math.max(BOT_FILL_TARGET, match.minimum));
      let botIndex = 0;
      while (match.filledSlots < target) {
        match.addSeat(botName(botIndex), true);
        botIndex++;
      }
      this.clearCountdown();
      match.start();
      if (this.filling === match) this.filling = null;
    }, Math.max(0, BOT_FILL_SECONDS) * 1000);
  }

  private clearBotFillTimer(): void {
    if (this.botFillTimer) clearTimeout(this.botFillTimer);
    this.botFillTimer = null;
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
