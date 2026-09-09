// Regression tests for the 2026-09-09 arena-shrink cascade fix (see
// [[Arena Collapse Cascade: Why Matches End With Nobody Left 2026-09-09]]
// in the wiki). Covers: (a) a burst of near-simultaneous eliminations
// cannot slam the ring shut in a single tick, progress stays monotonic,
// and (b) the fully-shrunk rectangle still leaves real standing room --
// not just "touches a platform", but enough width for a plausible
// handful of late-game survivors -- on all three shipped arenas.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { computeShrinkProgress, computeCurrentBlastRect } from '../src/arena-shrink.ts';
import { resolveMatchSettings } from '../src/match-settings.ts';
import * as fx from '../src/math/fixed.ts';
import { ALL_ARENAS } from '../../content/src/arenas.ts';

const SETTINGS = resolveMatchSettings({ arenaShrink: true, shrinkFullyClosedTick: 1000 });

// The largest shipped character hurtbox width (anchor, 24 world units --
// see packages/content/src/characters/anchor/data.ts). Used as a stand-in
// for "how much horizontal room one fighter needs".
const MAX_HURTBOX_WIDTH = 24;
// A plausible late-game survivor count to guarantee room for. Twenty
// fighters never all need to fit in the final ring -- by the time it is
// fully closed the field has thinned -- but a handful of finalists must
// always have somewhere solid to stand.
const LATE_GAME_SURVIVORS = 4;
const MIN_STANDING_WIDTH = MAX_HURTBOX_WIDTH * LATE_GAME_SURVIVORS;

describe('computeShrinkProgress: elimination burst is bounded', () => {
  it('a single tick of many simultaneous eliminations cannot jump progress by more than the alive-weight bonus', () => {
    const fighterCount = 20;
    for (const tick of [0, 10, 200, 999]) {
      const before = computeShrinkProgress(tick, fighterCount, fighterCount, SETTINGS); // nobody out yet
      // Worst case: everyone but one fighter is eliminated on this exact
      // tick (as extreme a "mass wipe on one frame" as the sim allows).
      const after = computeShrinkProgress(tick, 1, fighterCount, SETTINGS);
      const jump = fx.toFloat(after) - fx.toFloat(before);
      // Bonus weight is 0.15 (see ALIVE_WEIGHT in arena-shrink.ts); allow
      // a small epsilon for fixed-point rounding.
      assert.ok(jump <= 0.16, `progress jumped by ${jump} on a single-tick mass elimination at tick ${tick}`);
    }
  });

  it('progress is monotonically non-decreasing in tick alone (fixed elimination count)', () => {
    const fighterCount = 20;
    for (let eliminated = 0; eliminated < fighterCount; eliminated++) {
      const alive = fighterCount - eliminated;
      let prev = 0;
      for (let tick = 0; tick <= 1000; tick += 50) {
        const progress = fx.toFloat(computeShrinkProgress(tick, alive, fighterCount, SETTINGS));
        assert.ok(progress >= prev - 1e-6, `progress went backwards at tick ${tick}, alive ${alive}`);
        prev = progress;
      }
    }
  });

  it('progress is monotonically non-decreasing in eliminations alone (fixed tick)', () => {
    const fighterCount = 20;
    for (let tick = 0; tick <= 1000; tick += 50) {
      let prev = 0;
      for (let eliminated = 0; eliminated < fighterCount; eliminated++) {
        const alive = fighterCount - eliminated;
        const progress = fx.toFloat(computeShrinkProgress(tick, alive, fighterCount, SETTINGS));
        assert.ok(progress >= prev - 1e-6, `progress went backwards at tick ${tick}, alive ${alive}`);
        prev = progress;
      }
    }
  });

  it('the clock alone (nobody eliminated) can still reach full progress', () => {
    const fighterCount = 20;
    const progress = computeShrinkProgress(SETTINGS.shrinkFullyClosedTick, fighterCount, fighterCount, SETTINGS);
    assert.equal(fx.toFloat(progress), 1);
  });

  it('eliminations alone (clock at tick 0) only ever add a mild nudge, never full closure', () => {
    const fighterCount = 20;
    const progress = computeShrinkProgress(0, 1, fighterCount, SETTINGS); // all but one eliminated, no time passed
    assert.ok(fx.toFloat(progress) <= 0.16, `elimination-only progress was ${fx.toFloat(progress)}, expected a mild nudge`);
  });
});

describe('Fully-shrunk blast rect leaves real standing room on every arena', () => {
  for (const { id, arena } of ALL_ARENAS) {
    it(`${id}: closed rect width covers at least ${MIN_STANDING_WIDTH} units of a real platform`, () => {
      const rect = computeCurrentBlastRect(arena, SETTINGS.shrinkFullyClosedTick, 1, 20, SETTINGS);
      const minX = fx.toFloat(rect.minX);
      const maxX = fx.toFloat(rect.maxX);
      const minY = fx.toFloat(rect.minY);
      const maxY = fx.toFloat(rect.maxY);
      let bestOverlap = 0;
      for (const p of arena.platforms) {
        const pMinX = fx.toFloat(p.minX);
        const pMaxX = fx.toFloat(p.maxX);
        const pY = fx.toFloat(p.y);
        if (pY < minY || pY > maxY) continue;
        const overlap = Math.min(pMaxX, maxX) - Math.max(pMinX, minX);
        if (overlap > bestOverlap) bestOverlap = overlap;
      }
      assert.ok(
        bestOverlap >= MIN_STANDING_WIDTH,
        `${id}: best platform overlap with fully-closed rect is only ${bestOverlap} units (need ${MIN_STANDING_WIDTH})`,
      );
    });
  }
});
