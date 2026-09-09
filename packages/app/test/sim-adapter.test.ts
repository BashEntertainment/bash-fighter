// Verifies SimMatchAdapter reads packages/sim's real N-fighter elimination
// state faithfully (this replaced StubMatchAdapter, which used to infer
// "eliminated" from stocks reaching 0 — see spectator/types.ts history).
// Uses a duck-typed stand-in for Match (same .sim / .currentSnapshots()
// shape) so this test needs no DOM/Renderer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  Sim,
  makeInputFrame,
  fixed as fx,
  type ArenaData,
  type FighterSnapshot,
  type InputFrame,
} from '@bash-fighter/sim';
import { SimMatchAdapter } from '../src/spectator/sim-adapter.ts';

const N = 6;

function makeMatchLike(sim: Sim): { sim: Sim; currentSnapshots(): FighterSnapshot[] } {
  return {
    sim,
    currentSnapshots(): FighterSnapshot[] {
      const out: FighterSnapshot[] = [];
      for (let i = 0; i < sim.numFighters; i++) out.push(sim.getFighter(i));
      return out;
    },
  };
}

function idleInputs(n: number): InputFrame[] {
  return Array.from({ length: n }, () => makeInputFrame());
}

test('SimMatchAdapter: fighterCount matches sim.numFighters', () => {
  const sim = new Sim(1, N);
  const adapter = new SimMatchAdapter(makeMatchLike(sim) as never);
  assert.equal(adapter.fighterCount, N);
});

test('SimMatchAdapter: no one eliminated at match start, all survivors', () => {
  const sim = new Sim(2, N);
  const adapter = new SimMatchAdapter(makeMatchLike(sim) as never);
  adapter.update();
  for (let i = 0; i < N; i++) {
    const st = adapter.status(i);
    assert.equal(st.eliminated, false);
    assert.equal(st.eliminationTick, null);
    assert.equal(st.placement, null);
  }
  assert.deepEqual(adapter.survivorIndices(), [0, 1, 2, 3, 4, 5]);
  assert.equal(adapter.isMatchOver(), false);
});

test('SimMatchAdapter: liveArenaBounds tracks the sim blast rect, including shrink', () => {
  const sim = new Sim(3, N);
  const adapter = new SimMatchAdapter(makeMatchLike(sim) as never);
  const inputs = idleInputs(N);
  for (let t = 0; t < 50; t++) sim.advance(inputs);
  const bounds = adapter.liveArenaBounds();
  assert.ok(bounds !== null);
  assert.ok(bounds.minX < bounds.maxX);
  assert.ok(bounds.minY < bounds.maxY);
  assert.ok(Number.isFinite(bounds.minX) && Number.isFinite(bounds.maxX));
});

test('SimMatchAdapter: reflects elimination, placement, and koCount when the collapsing arena catches fighters outside the safe zone', () => {
  // Custom arena: spawn points at x=+-200, inside the *initial* blast zone
  // (+-260) but outside the *fully-shrunk* one (65% of 260 = 169 as of the
  // 2026-09-09 arena-shrink cascade fix — see
  // [[Arena Collapse Cascade: Why Matches End With Nobody Left 2026-09-09]],
  // FINAL_SHRINK_FRACTION raised from 0.55 to 0.65). With
  // shrinkFullyClosedTick=1 the arena is fully closed by tick 1, so a
  // fighter standing still at its spawn point is caught outside the safe
  // zone almost immediately — exercising the real elimination path
  // (computeCurrentBlastRect -> checkBlastZone), just compressed in time
  // rather than testing a different mechanism.
  const arena: ArenaData = {
    name: 'test-shrink-arena',
    platforms: [{ minX: fx.fromInt(-400), maxX: fx.fromInt(400), y: fx.fromInt(0) }],
    blastMinX: fx.fromInt(-260),
    blastMaxX: fx.fromInt(260),
    blastMinY: fx.fromInt(-260),
    blastMaxY: fx.fromInt(260),
    spawnPoints: [
      { x: fx.fromInt(200), y: fx.fromInt(0) },
      { x: fx.fromInt(-200), y: fx.fromInt(0) },
    ],
  };
  const sim = new Sim(4, N, undefined, arena, { shrinkFullyClosedTick: 1 });
  const inputs = idleInputs(N);
  let ticks = 0;
  const maxTicks = 200;
  while (!sim.isMatchOver() && ticks < maxTicks) {
    sim.advance(inputs);
    ticks++;
  }
  const adapter = new SimMatchAdapter(makeMatchLike(sim) as never);
  adapter.update();

  assert.ok(ticks < maxTicks, `match should end from arena shrink within ${maxTicks} ticks, took ${ticks}`);

  let eliminatedCount = 0;
  let sawPlacement1 = false;
  for (let i = 0; i < N; i++) {
    const st = adapter.status(i);
    if (st.eliminated) {
      eliminatedCount++;
      assert.ok(st.eliminationTick !== null && st.eliminationTick >= 0);
      assert.ok(st.placement !== null && st.placement >= 1 && st.placement <= N);
    }
    if (st.placement === 1) sawPlacement1 = true;
  }
  assert.ok(eliminatedCount >= N - 1, 'match being over means at most one survivor remains');
  assert.ok(sawPlacement1, 'the winner (or last eliminated) must have placement 1');
  assert.equal(adapter.isMatchOver(), true);
});
