// Tests for the bot input source (packages/sim/src/ai/bot.ts). Per this
// task's brief: (1) determinism — a match with bots produces identical
// hash sequences from the same seed; (2) a bot placed alone on a platform
// does not self-destruct over several thousand ticks; (3) a bot moves
// inward as the arena shrinks. See assertHashSequenceEqual's rationale in
// determinism.test.ts — never assert.deepEqual two long arrays here.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Sim } from '../src/sim.ts';
import { hashStateBuffer } from '../src/hash.ts';
import { makeInputFrame } from '../src/types.ts';
import { BotController, BotDifficulty, deriveBotSeed } from '../src/ai/bot.ts';
import type { ArenaData } from '../src/arena/types.ts';
import * as fx from '../src/math/fixed.ts';

const MATCH_SEED = 12345;

function runBotMatch(numFighters: number, ticks: number, settings: Record<string, unknown> = {}): string[] {
  const sim = new Sim(MATCH_SEED, numFighters, undefined, undefined, settings);
  const bots = Array.from(
    { length: numFighters },
    (_, i) => new BotController(i, BotDifficulty.MEDIUM, deriveBotSeed(MATCH_SEED, i)),
  );
  const buf = sim.createStateBuffer();
  const hashes: string[] = [];
  for (let t = 0; t < ticks; t++) {
    const inputs = bots.map((b) => b.nextInput(sim));
    sim.advance(inputs);
    sim.saveState(buf);
    hashes.push(hashStateBuffer(buf));
  }
  return hashes;
}

function assertHashSequenceEqual(actual: string[], expected: string[], label: string): void {
  assert.equal(
    actual.length,
    expected.length,
    `${label}: length mismatch (got ${actual.length}, expected ${expected.length})`,
  );
  for (let i = 0; i < actual.length; i++) {
    if (actual[i] !== expected[i]) {
      assert.fail(`${label}: diverged at frame ${i} of ${actual.length} (got ${actual[i]}, expected ${expected[i]})`);
    }
  }
}

describe('BotController determinism', () => {
  it('two independent runs of the same seed + bot config produce identical hash sequences', () => {
    const a = runBotMatch(4, 1500, { winCondition: 'stocks', startingStocks: 5, arenaShrink: false });
    const b = runBotMatch(4, 1500, { winCondition: 'stocks', startingStocks: 5, arenaShrink: false });
    assertHashSequenceEqual(a, b, 'bot match run1 vs run2');
  });
});

describe('BotController does not self-destruct', () => {
  it('a lone bot on a platform, facing a passive opponent, survives several thousand ticks', () => {
    const sim = new Sim(MATCH_SEED, 2, undefined, undefined, {
      winCondition: 'stocks',
      startingStocks: 20,
      arenaShrink: false,
    });
    const bot = new BotController(0, BotDifficulty.MEDIUM, deriveBotSeed(MATCH_SEED, 0));
    const neutral = makeInputFrame();
    for (let t = 0; t < 5000; t++) {
      sim.advance([bot.nextInput(sim), neutral]);
    }
    const snap = sim.getFighter(0);
    assert.equal(snap.eliminated, false, 'bot must not have been eliminated');
    assert.ok(snap.stocks > 0, 'bot must still have stocks remaining');
  });
});

describe('BotController arena-shrink awareness', () => {
  it('moves inward as the blast rect closes rather than holding its ground', () => {
    const wideArena: ArenaData = {
      name: 'test-wide',
      platforms: [{ minX: fx.fromInt(-400), maxX: fx.fromInt(400), y: fx.fromInt(0) }],
      blastMinX: fx.fromInt(-460),
      blastMaxX: fx.fromInt(460),
      blastMinY: fx.fromInt(-200),
      blastMaxY: fx.fromInt(300),
      spawnPoints: [
        { x: fx.fromInt(380), y: fx.fromInt(0) },
        { x: fx.fromInt(-380), y: fx.fromInt(0) },
      ],
    };
    const sim = new Sim(MATCH_SEED, 2, undefined, wideArena, {
      winCondition: 'battleRoyale',
      arenaShrink: true,
      shrinkFullyClosedTick: 300,
    });
    const bot = new BotController(0, BotDifficulty.HARD, deriveBotSeed(MATCH_SEED, 0));
    const bot1 = new BotController(1, BotDifficulty.HARD, deriveBotSeed(MATCH_SEED, 1));
    const earlyX = sim.getFighter(0).posX;
    for (let t = 0; t < 500; t++) {
      sim.advance([bot.nextInput(sim), bot1.nextInput(sim)]);
    }
    const snap = sim.getFighter(0);
    // Started at x=380 near the right edge; the blast rect closes toward
    // the center over 300 ticks, so a bot that respects it must have moved
    // meaningfully leftward (toward 0) rather than sitting still or
    // drifting further right.
    assert.ok(
      fx.toFloat(snap.posX) < fx.toFloat(earlyX) - 20,
      `expected bot to move inward from ${fx.toFloat(earlyX)}, ended at ${fx.toFloat(snap.posX)}`,
    );
  });
});
