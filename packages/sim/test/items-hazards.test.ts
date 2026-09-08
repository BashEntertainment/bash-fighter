// Tests for the item system and stage hazard (this task's deliverable).
// See packages/sim/src/items/types.ts and packages/sim/src/hazards/types.ts
// for the design rationale; this file only tests behavior.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Sim, MAX_ITEMS, MAX_HAZARDS } from '../src/sim.ts';
import { hashStateBuffer } from '../src/hash.ts';
import { makeInputFrame, BUTTON_ATTACK } from '../src/types.ts';

const NEUTRAL = makeInputFrame(0, 0, 0);
import * as fx from '../src/math/fixed.ts';
import type { ArenaData } from '../src/arena/types.ts';
import { PLACEHOLDER_CHARACTER } from '../../content/src/characters/placeholder/data.ts';
import { BASH_FIGHTER_ITEM_SET } from '../../content/src/items/data.ts';
import { BASH_FIGHTER_HAZARD } from '../../content/src/hazards/data.ts';

// Same "compare first divergence, never deepEqual a huge array" pattern as
// determinism.test.ts's assertHashSequenceEqual, to avoid the OOM incident
// on 2026-09-07.
function assertHashSequenceEqual(actual: string[], expected: string[], label: string): void {
  assert.equal(actual.length, expected.length, `${label}: length mismatch`);
  for (let i = 0; i < actual.length; i++) {
    if (actual[i] !== expected[i]) {
      assert.fail(`${label}: diverged at frame ${i} of ${actual.length} (got ${actual[i]}, expected ${expected[i]})`);
    }
  }
}

const CHARACTERS = [
  PLACEHOLDER_CHARACTER,
  PLACEHOLDER_CHARACTER,
  PLACEHOLDER_CHARACTER,
  PLACEHOLDER_CHARACTER,
] as const;

// A small arena with several platforms and spawn points spread out, so
// items/hazards have somewhere to fall onto and fighters have room to
// wander into (and out of) them over a multi-thousand-tick run.
const TEST_ARENA: ArenaData = {
  name: 'Item/Hazard Test Stage',
  platforms: [{ minX: fx.fromInt(-200), maxX: fx.fromInt(200), y: fx.fromInt(0) }],
  blastMinX: fx.fromInt(-260),
  blastMaxX: fx.fromInt(260),
  blastMinY: fx.fromInt(-120),
  blastMaxY: fx.fromInt(220),
  spawnPoints: [
    { x: fx.fromInt(-60), y: fx.fromInt(0) },
    { x: fx.fromInt(-20), y: fx.fromInt(0) },
    { x: fx.fromInt(20), y: fx.fromInt(0) },
    { x: fx.fromInt(60), y: fx.fromInt(0) },
  ],
};

function botInput(index: number, tick: number) {
  // Deterministic pseudo-wander: walk in a direction that flips every
  // ~90 ticks, occasionally pressing attack, so fighters cross paths with
  // spawned items/hazards and sometimes hold+use items.
  const phase = (tick + index * 37) % 180;
  const dir = phase < 90 ? 1 : -1;
  const attack = (tick + index * 13) % 47 === 0;
  return makeInputFrame(attack ? BUTTON_ATTACK : 0, fx.fromInt(dir), 0);
}

function runChaosMatch(seed: number, ticks: number): string[] {
  const sim = new Sim(seed, 4, CHARACTERS, TEST_ARENA, {}, BASH_FIGHTER_ITEM_SET, BASH_FIGHTER_HAZARD);
  const buf = sim.createStateBuffer();
  const hashes: string[] = [];
  for (let t = 0; t < ticks; t++) {
    if (sim.isMatchOver()) break;
    sim.advance([botInput(0, t), botInput(1, t), botInput(2, t), botInput(3, t)]);
    sim.saveState(buf);
    hashes.push(hashStateBuffer(buf));
  }
  return hashes;
}

describe('Items and hazards: determinism', () => {
  it('two independent Sims with the same seed produce identical hash sequences with items and hazards active', () => {
    const a = runChaosMatch(777, 4000);
    const b = runChaosMatch(777, 4000);
    assert.ok(a.length > 1000, 'expected the chaos match to run for a meaningful number of ticks');
    assertHashSequenceEqual(a, b, 'seed 777 run 1 vs run 2');
  });

  it('a different seed diverges from the first (sanity check that items/hazards are not accidentally seed-independent)', () => {
    const a = runChaosMatch(777, 1500);
    const c = runChaosMatch(999, 1500);
    assert.notEqual(hashStateBuffer as unknown, undefined);
    let diverged = false;
    for (let i = 0; i < Math.min(a.length, c.length); i++) {
      if (a[i] !== c[i]) {
        diverged = true;
        break;
      }
    }
    assert.ok(diverged, 'expected different seeds to diverge at some point');
  });
});

describe('Items and hazards: save/load round trip', () => {
  it('item and hazard state survives a mid-match saveState/loadState and continues identically', () => {
    // Per the task note: a Sim receiving loadState must be constructed with
    // the same settings/arena or it diverges immediately.
    const seed = 4242;
    const splitTick = 900;
    const totalTicks = 3000;

    const reference = new Sim(seed, 4, CHARACTERS, TEST_ARENA, {}, BASH_FIGHTER_ITEM_SET, BASH_FIGHTER_HAZARD);
    const refBuf = reference.createStateBuffer();
    const referenceHashes: string[] = [];
    for (let t = 0; t < totalTicks; t++) {
      reference.advance([botInput(0, t), botInput(1, t), botInput(2, t), botInput(3, t)]);
      reference.saveState(refBuf);
      referenceHashes.push(hashStateBuffer(refBuf));
    }

    const resumed = new Sim(seed, 4, CHARACTERS, TEST_ARENA, {}, BASH_FIGHTER_ITEM_SET, BASH_FIGHTER_HAZARD);
    const resumedBuf = resumed.createStateBuffer();
    let savedAtSplit: Int32Array | null = null;
    const resumedHashes: string[] = [];
    for (let t = 0; t < splitTick; t++) {
      resumed.advance([botInput(0, t), botInput(1, t), botInput(2, t), botInput(3, t)]);
      if (t === splitTick - 1) {
        resumed.saveState(resumedBuf);
        savedAtSplit = resumedBuf.slice();
      }
    }
    assert.ok(savedAtSplit, 'expected a snapshot to have been taken');

    // A *fresh* Sim, same construction args, loading the mid-match snapshot.
    const fromSnapshot = new Sim(seed, 4, CHARACTERS, TEST_ARENA, {}, BASH_FIGHTER_ITEM_SET, BASH_FIGHTER_HAZARD);
    fromSnapshot.loadState(savedAtSplit as Int32Array);
    const fromSnapshotBuf = fromSnapshot.createStateBuffer();
    for (let t = splitTick; t < totalTicks; t++) {
      fromSnapshot.advance([botInput(0, t), botInput(1, t), botInput(2, t), botInput(3, t)]);
      fromSnapshot.saveState(fromSnapshotBuf);
      resumedHashes.push(hashStateBuffer(fromSnapshotBuf));
    }

    const referenceTail = referenceHashes.slice(splitTick);
    assertHashSequenceEqual(resumedHashes, referenceTail, 'resumed-from-snapshot vs uninterrupted reference (tail)');
  });
});

describe('Items: pickup tie-breaking', () => {
  it('when several fighters overlap a world item on the same tick, the lowest fighter index picks it up', () => {
    // Single spawn point: all fighters start exactly on top of it, and the
    // first item spawn lands there too, guaranteeing a 3-way tie.
    const arena: ArenaData = {
      name: 'Single Point',
      platforms: [{ minX: fx.fromInt(-100), maxX: fx.fromInt(100), y: fx.fromInt(0) }],
      blastMinX: fx.fromInt(-200),
      blastMaxX: fx.fromInt(200),
      blastMinY: fx.fromInt(-120),
      blastMaxY: fx.fromInt(220),
      spawnPoints: [{ x: fx.fromInt(0), y: fx.fromInt(0) }],
    };
    const sim = new Sim(1, 3, CHARACTERS.slice(0, 3), arena, {}, BASH_FIGHTER_ITEM_SET, BASH_FIGHTER_HAZARD);
    let pickedUpSlot = -1;
    for (let t = 0; t < 320 && pickedUpSlot < 0; t++) {
      sim.advance([NEUTRAL, NEUTRAL, NEUTRAL]);
      for (let slot = 0; slot < MAX_ITEMS; slot++) {
        const item = sim.getItem(slot);
        if (item.active && item.holder >= 0) {
          pickedUpSlot = slot;
          assert.equal(item.holder, 0, 'expected the lowest fighter index (0) to win the simultaneous pickup');
          break;
        }
      }
    }
    assert.ok(pickedUpSlot >= 0, 'expected an item to spawn and be picked up within the tick budget');
  });
});

describe('Items: despawn', () => {
  it('a world item despawns after its timeout with nobody around to pick it up', () => {
    // Fighters sit far from every spawn point so nothing ever picks the
    // item up; it must disappear on its own once its timer runs out.
    const arena: ArenaData = {
      name: 'Far Spawns',
      platforms: [{ minX: fx.fromInt(-300), maxX: fx.fromInt(300), y: fx.fromInt(0) }],
      blastMinX: fx.fromInt(-400),
      blastMaxX: fx.fromInt(400),
      blastMinY: fx.fromInt(-120),
      blastMaxY: fx.fromInt(220),
      spawnPoints: [{ x: fx.fromInt(0), y: fx.fromInt(0) }],
    };
    const farCharacters = [PLACEHOLDER_CHARACTER, PLACEHOLDER_CHARACTER];
    // A single item type whose despawnTicks does not divide evenly into
    // ITEM_SPAWN_INTERVAL_TICKS (300), so despawn and the next spawn
    // attempt land on different ticks -- otherwise the slot would flip
    // from despawned straight back to a freshly spawned item on the same
    // sample and the momentary empty gap this test checks for would never
    // be observed.
    const shortLivedItem = [{ ...BASH_FIGHTER_ITEM_SET[0]!, despawnTicks: 250 }];
    const sim = new Sim(2, 2, farCharacters, arena, {}, shortLivedItem, BASH_FIGHTER_HAZARD);
    // Walk both fighters far away immediately so neither can ever overlap
    // the item.
    let sawSpawn = false;
    let sawDespawn = false;
    for (let t = 0; t < 1400; t++) {
      sim.advance([makeInputFrame(0, fx.fromInt(-1), 0), makeInputFrame(0, fx.fromInt(1), 0)]);
      const item = sim.getItem(0);
      if (item.active) sawSpawn = true;
      if (sawSpawn && !item.active) {
        sawDespawn = true;
        break;
      }
    }
    assert.ok(sawSpawn, 'expected the item to spawn');
    assert.ok(sawDespawn, 'expected the unclaimed item to despawn on its own within the tick budget');
  });
});

describe('Hazards: damage', () => {
  it('a falling hazard damages a fighter it passes through', () => {
    // A single-fighter arena with a spawn point directly under where the
    // hazard always spawns (X = midpoint of the blast rect, since the
    // hazard config's default spawn draw can land at X=0 here): sit the
    // fighter still and confirm percent increases once the hazard falls
    // through it.
    const arena: ArenaData = {
      name: 'Hazard Alley',
      platforms: [{ minX: fx.fromInt(-100), maxX: fx.fromInt(100), y: fx.fromInt(0) }],
      blastMinX: fx.fromInt(-4),
      blastMaxX: fx.fromInt(4),
      blastMinY: fx.fromInt(-50),
      blastMaxY: fx.fromInt(50),
      spawnPoints: [{ x: fx.fromInt(0), y: fx.fromInt(0) }],
    };
    const hazard = { ...BASH_FIGHTER_HAZARD, spawnIntervalMaxTicks: 30, spawnIntervalMinTicks: 30 };
    const sim = new Sim(3, 2, [PLACEHOLDER_CHARACTER, PLACEHOLDER_CHARACTER], arena, {}, [], hazard);
    const before = sim.getFighter(0).percent;
    let tookDamage = false;
    for (let t = 0; t < 300; t++) {
      sim.advance([NEUTRAL, NEUTRAL]);
      if (sim.getFighter(0).percent > before) {
        tookDamage = true;
        break;
      }
    }
    assert.ok(tookDamage, 'expected the falling hazard to damage the fighter standing in its path');
  });

  it('a hazard slot goes inactive again after despawning (does not leak forever)', () => {
    const arena: ArenaData = {
      name: 'Hazard Alley 2',
      platforms: [{ minX: fx.fromInt(-100), maxX: fx.fromInt(100), y: fx.fromInt(0) }],
      blastMinX: fx.fromInt(-4),
      blastMaxX: fx.fromInt(4),
      blastMinY: fx.fromInt(-10),
      blastMaxY: fx.fromInt(50),
      spawnPoints: [{ x: fx.fromInt(0), y: fx.fromInt(0) }],
    };
    const hazard = { ...BASH_FIGHTER_HAZARD, spawnIntervalMaxTicks: 20, spawnIntervalMinTicks: 20 };
    const sim = new Sim(5, 2, [PLACEHOLDER_CHARACTER, PLACEHOLDER_CHARACTER], arena, {}, [], hazard);
    let sawActive = false;
    let sawInactiveAfter = false;
    for (let t = 0; t < 400; t++) {
      sim.advance([NEUTRAL, NEUTRAL]);
      let anyActive = false;
      for (let slot = 0; slot < MAX_HAZARDS; slot++) {
        if (sim.getHazard(slot).active) anyActive = true;
      }
      if (anyActive) sawActive = true;
      if (sawActive && !anyActive) {
        sawInactiveAfter = true;
        break;
      }
    }
    assert.ok(sawActive, 'expected a hazard to spawn');
    assert.ok(sawInactiveAfter, 'expected the hazard slot to free up again after it fell out of the blast rect');
  });
});
