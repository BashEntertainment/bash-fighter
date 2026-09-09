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

test('SimMatchAdapter: a fighter standing on the platform is never eliminated by an instantly-fully-shrunk boundary, no matter how tight the schedule', () => {
  // REVISED 2026-09-09 for the arena-shrink rework (see wiki "Arena
  // Collapse Cascade: Why Matches End With Nobody Left 2026-09-09" and
  // "Arena Shrink Rework: Fighting Decides Matches 2026-09-09"). The old
  // version of this test *intentionally* built a platform wider than the
  // blast zone and asserted the shrunk boundary swept over it, eliminating
  // a fighter standing still on solid ground — that was the very defect
  // the rework fixes, so that assertion is now the wrong thing to test for.
  // This version keeps the platform narrower than the blast zone and
  // drives shrinkFullyClosedTick down to 1 (instant full closure): every
  // fighter still standing on the platform must survive regardless, because
  // computeSafeExtents() derives its floor from the platform's own bounding
  // box, not a hand-picked fraction. (A fighter cannot walk or spawn past a
  // platform's edge while grounded -- the ground-collision clamp in sim.ts
  // that another agent owns prevents it -- so "off the platform" is not a
  // reachable state to also assert on here; the arena-shrink unit tests and
  // the passive-player bot test cover boundary elimination once the field
  // has actually thinned.)
  const arena: ArenaData = {
    name: 'test-shrink-arena',
    platforms: [{ minX: fx.fromInt(-100), maxX: fx.fromInt(100), y: fx.fromInt(0) }],
    blastMinX: fx.fromInt(-260),
    blastMaxX: fx.fromInt(260),
    blastMinY: fx.fromInt(-260),
    blastMaxY: fx.fromInt(260),
    spawnPoints: [
      { x: fx.fromInt(60), y: fx.fromInt(0) },
      { x: fx.fromInt(-60), y: fx.fromInt(0) },
    ],
  };
  const sim = new Sim(4, N, undefined, arena, { shrinkFullyClosedTick: 1 });
  const inputs = idleInputs(N);
  const maxTicks = 200;
  for (let t = 0; t < maxTicks; t++) sim.advance(inputs);
  const adapter = new SimMatchAdapter(makeMatchLike(sim) as never);
  adapter.update();

  for (let i = 0; i < N; i++) {
    const st = adapter.status(i);
    assert.equal(st.eliminated, false, `fighter ${i} standing on the platform was eliminated by an instantly-shrunk boundary`);
  }
  assert.equal(adapter.isMatchOver(), false, 'the whole field standing safely on the platform means the match is not over');
});
