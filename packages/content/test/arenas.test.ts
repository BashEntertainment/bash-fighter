// Stage system tests (this task's stage-variety pass). Covers: every
// shipped arena passes schema validation, has 20 non-overlapping spawn
// points, and -- the property that actually matters for "a stage whose
// safe space closes into a gap with no floor is a bug" -- the fully
// shrunk endgame blast rectangle always still overlaps some solid
// platform. Also covers the registry (resolveArenaId/pickArenaId) that
// the server uses to pick and communicate a stage.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validateArena } from '../src/validate.ts';
import { ALL_ARENAS, DEFAULT_ARENA_ID, resolveArenaId, isKnownArenaId, pickArenaId } from '../src/arenas.ts';
import { computeCurrentBlastRect } from '../../sim/src/arena-shrink.ts';
import { resolveMatchSettings } from '../../sim/src/match-settings.ts';
import * as fx from '../../sim/src/math/fixed.ts';

const FULLY_SHRUNK_SETTINGS = resolveMatchSettings({ arenaShrink: true, shrinkFullyClosedTick: 100 });

describe('Every shipped arena validates', () => {
  for (const { id, arena } of ALL_ARENAS) {
    it(`${id} (${arena.name}) has no validation errors`, () => {
      assert.deepEqual(validateArena(arena), []);
    });

    it(`${id} defines exactly 20 spawn points`, () => {
      assert.equal(arena.spawnPoints.length, 20);
    });

    it(`${id} spawn points don't overlap (hurtbox-width clearance)`, () => {
      // Placeholder-class hurtbox width is 16 world units (see
      // characters/placeholder/data.ts); require at least that much
      // clearance between any two spawn points that share a y (the only
      // way two spawns could actually overlap a standing fighter).
      const minClearance = 16;
      const byY = new Map<number, number[]>();
      for (const sp of arena.spawnPoints) {
        const y = fx.toFloat(sp.y);
        const list = byY.get(y) ?? [];
        list.push(fx.toFloat(sp.x));
        byY.set(y, list);
      }
      for (const xs of byY.values()) {
        xs.sort((a, b) => a - b);
        for (let i = 1; i < xs.length; i++) {
          assert.ok(
            xs[i]! - xs[i - 1]! >= minClearance,
            `spawn points ${xs[i - 1]} and ${xs[i]} are closer than ${minClearance} units`,
          );
        }
      }
    });

    it(`${id}'s fully-shrunk endgame blast rectangle still overlaps a platform`, () => {
      // aliveCount=1 and tick past shrinkFullyClosedTick both drive
      // progress to 1 (fully shrunk) -- the worst case a real match can
      // reach. If the resulting rectangle contains no point that lies on
      // any platform's surface, the safe zone has closed onto a gap with
      // no floor: exactly the bug class this task was told to avoid.
      const rect = computeCurrentBlastRect(arena, 100, 1, 20, FULLY_SHRUNK_SETTINGS);
      const minX = fx.toFloat(rect.minX);
      const maxX = fx.toFloat(rect.maxX);
      const minY = fx.toFloat(rect.minY);
      const maxY = fx.toFloat(rect.maxY);
      const hasFloor = arena.platforms.some((p) => {
        const pMinX = fx.toFloat(p.minX);
        const pMaxX = fx.toFloat(p.maxX);
        const pY = fx.toFloat(p.y);
        const xOverlaps = pMaxX >= minX && pMinX <= maxX;
        const yInRange = pY >= minY && pY <= maxY;
        return xOverlaps && yInRange;
      });
      assert.ok(hasFloor, `${id}: no platform overlaps the fully-shrunk rect [${minX},${maxX}]x[${minY},${maxY}]`);
    });
  }
});

describe('Arena registry', () => {
  it('has at least three distinct stages', () => {
    assert.ok(ALL_ARENAS.length >= 3);
  });

  it('resolveArenaId returns the matching arena for a known id', () => {
    for (const { id, arena } of ALL_ARENAS) {
      assert.equal(resolveArenaId(id), arena);
    }
  });

  it('resolveArenaId falls back to the default for an unknown/absent id', () => {
    const fallback = resolveArenaId(undefined);
    assert.equal(fallback, resolveArenaId(DEFAULT_ARENA_ID));
    assert.equal(resolveArenaId('not-a-real-arena'), fallback);
  });

  it('isKnownArenaId is true only for real ids', () => {
    for (const { id } of ALL_ARENAS) assert.ok(isKnownArenaId(id));
    assert.equal(isKnownArenaId('nope'), false);
    assert.equal(isKnownArenaId(undefined), false);
  });

  it('pickArenaId is deterministic: same seed always picks the same stage', () => {
    assert.equal(pickArenaId(12345), pickArenaId(12345));
    assert.equal(pickArenaId(0), pickArenaId(0));
  });

  it('pickArenaId always returns a known id', () => {
    for (const seed of [0, 1, -1, 999999, 2 ** 31 - 1]) {
      assert.ok(isKnownArenaId(pickArenaId(seed)));
    }
  });
});
