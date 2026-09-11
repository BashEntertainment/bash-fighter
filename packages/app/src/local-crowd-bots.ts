// Pure helpers pulled out of match.ts's Match constructor/tick() so the
// crowd-fill regression test can import them directly under Node's
// --experimental-strip-types (match.ts itself uses a TS "parameter
// property" in its constructor -- `private readonly events: MatchEvents
// = {}` -- which Node's type-stripping does not support, so it cannot be
// imported from a plain `node --test` run; see
// packages/app/test/local-crowd-bots.test.ts).
import {
  BotController,
  BotDifficulty,
  deriveBotSeed,
  makeInputFrame,
  type Sim,
  type InputFrame,
} from '@bash-fighter/sim';

/** Bot-fills every fighter slot at/after humanSlotCount, deterministically
 * seeded from the match seed exactly like the server does per-seat (see
 * server/src/match.ts) -- just decided locally by slot index instead of a
 * per-seat isBot flag. Slots before humanSlotCount are left for
 * InputManager (real local players) and get no bot. */
export type { BotController };

export function buildLocalBots(seed: number, numFighters: number, humanSlotCount: number): Map<number, BotController> {
  const bots = new Map<number, BotController>();
  for (let slot = humanSlotCount; slot < numFighters; slot++) {
    bots.set(slot, new BotController(slot, BotDifficulty.EASY, deriveBotSeed(seed, slot)));
  }
  return bots;
}

/** Builds one Sim.advance()-ready InputFrame per fighter slot: bot slots
 * get their BotController's decision, human slots get whatever
 * InputManager.poll() returned for them, and any slot neither covers
 * (should not happen, but keeps this total) gets a neutral idle frame
 * rather than leaving the array short and failing Sim.advance()'s length
 * assertion -- that assertion failing ("advance: expected N inputs, got
 * 2") is exactly what made ?crowd20=1 throw every tick before this fix. */
export function buildTickInputs(
  sim: Sim,
  polled: readonly InputFrame[],
  bots: ReadonlyMap<number, BotController>,
  numFighters: number,
): InputFrame[] {
  return Array.from({ length: numFighters }, (_, i) => {
    const bot = bots.get(i);
    if (bot) return bot.nextInput(sim);
    return polled[i] ?? makeInputFrame(0, 0, 0);
  });
}
