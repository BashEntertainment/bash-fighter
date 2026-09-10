// Deterministic arena-shrink schedule (owner decision 2026-09-07: default
// battle-royale mode needs the blast zone to close in as the field thins,
// so surviving fighters are forced together instead of idling in a huge
// arena). Pure function of (tick, aliveCount, N, arena, settings) — no
// wall-clock time, no client-local randomness — so it is fully replayable
// and its *result* is stored back into sim state each tick (see
// CURRENT_BLAST_* words in sim.ts) so save/load carries it exactly, rather
// than being a rendering-only effect recomputed from scratch by a client.
//
// REVISED 2026-09-09 (see wiki "Arena Collapse Cascade: Why Matches End
// With Nobody Left 2026-09-09" and "Arena Shrink Rework: Fighting Decides
// Matches 2026-09-09"). Two real defects were found by playing production:
//
// 1. The final shrink target was a hand-picked fraction (0.55) of each
//    arena's *initial* blast half-extents, with no relationship to where
//    that arena's platforms actually are. On battle-royale-20 and
//    the-undercroft this put the closed boundary inside solid, visibly
//    drawn standing ground. Fixed in two parts, both derived from the
//    arena's own geometry rather than hand-picked per stage:
//      a) computeGroundHalfExtents() reads the bounding box of every
//         platform in the arena. While most of the field is still alive
//         the boundary is clamped to never close tighter than that box
//         (plus STANDING_MARGIN) -- ground is never swept.
//      b) As the field thins, that floor is allowed to relax toward
//         computeMinFinalHalfExtents(), a floor sized only from
//         SPACE_PER_FIGHTER * FINAL_RING_FIGHTERS -- i.e. "how much room
//         does a final few need to stand", not a stage-specific number.
//         The interpolation between (a) and (b) is driven by *current
//         alive count*, so final ring size and roster size are the one
//         formula, and a full field is never squeezed into a small-ring
//         space meant for the endgame.
// 2. `aliveT = eliminated / (N - 1)` fed on its own output: eliminations
//    accelerated the shrink that produces eliminations, so 10 deaths out
//    of 20 alone already closed the boundary halfway regardless of the
//    clock. Fixed by damping: the alive-driven term is capped at
//    ALIVE_TERM_CAP and grows with sqrt(rawAliveT), so it can never alone
//    reach full closure -- only the tick-driven clock term can finish the
//    job. This keeps the *reason* the term exists (don't let two
//    survivors idle in a huge arena forever) without letting it feed a
//    runaway loop. Note this remains a *driver of tightness*, separate
//    from the population-based floor in (1b) which is a *limit on how
//    tight tightness is allowed to go* -- the floor can never itself
//    cause an elimination, it only permits the schedule to close further
//    once fewer fighters need the room.
import type { Fixed } from './math/fixed.ts';
import * as fx from './math/fixed.ts';
import type { ArenaData } from './arena/types.ts';
import type { MatchSettings } from './match-settings.ts';

export interface BlastRect {
  minX: Fixed;
  maxX: Fixed;
  minY: Fixed;
  maxY: Fixed;
}

/** Cap on how much of shrink `progress` the elimination-driven term can
 * contribute on its own, independent of the clock. 0.6 means: even if
 * every fighter but one were eliminated on tick 0, the alive-driven term
 * alone could only push the ring to 60% closed — full closure still
 * requires the tick clock to also advance. This is what stops the
 * cascade: the term can no longer feed itself all the way to 1.0. */
const ALIVE_TERM_CAP: Fixed = fx.fromFloat(0.6);

/** World-unit margin kept between a platform's outer edge (or its
 * y-level, for the vertical check) and the boundary that protects it --
 * the boundary stops just outside standing ground, not flush against it,
 * so there is a moment to see and react rather than a razor's edge.
 * Roughly two hurtbox-widths (placeholder hurtboxWidth/2 = 8). */
const STANDING_MARGIN: Fixed = fx.fromInt(20);

/** How much horizontal room one standing fighter needs, used only to
 * size the *final* ring floor from roster size — never hand-picked per
 * stage. Roughly a fighter's hurtbox width (16) plus enough gap either
 * side to swing (~2x hurtbox), rounded. */
const SPACE_PER_FIGHTER: Fixed = fx.fromInt(40);

/** How many fighters the fully-closed ring must comfortably fit. Chosen
 * so the last handful of a 20-player match still has room to maneuver
 * around each other and the arena's own hazards, rather than being
 * pinned to a point. This is a fighter-count constant, not a stage
 * constant -- it applies identically to every arena. */
const FINAL_RING_FIGHTERS = 6;

function lerp(a: Fixed, b: Fixed, t: Fixed): Fixed {
  return fx.add(a, fx.mul(fx.sub(b, a), t));
}

function fxMinNum(a: Fixed, b: Fixed): Fixed {
  return (a as number) < (b as number) ? a : b;
}
function fxMaxNum(a: Fixed, b: Fixed): Fixed {
  return (a as number) > (b as number) ? a : b;
}

/** progress in [0, ONE]: the maximum of a tick-driven "hazard storm" clock
 * and a damped, capped alive-count-driven closing ring. Monotonic in
 * tick; the alive-driven term is monotonic in eliminations too, but
 * bounded, so it cannot alone cascade to full closure. */
export function computeShrinkProgress(
  tick: number,
  aliveCount: number,
  fighterCount: number,
  settings: MatchSettings,
): Fixed {
  if (!settings.arenaShrink) return 0;
  const tickDenom = settings.shrinkFullyClosedTick > 0 ? settings.shrinkFullyClosedTick : 1;
  const tickT = fx.clamp(fx.div(fx.fromInt(Math.min(tick, tickDenom)), fx.fromInt(tickDenom)), 0, fx.ONE);
  const aliveDenom = fighterCount > 1 ? fighterCount - 1 : 1;
  const eliminated = fighterCount - aliveCount;
  const rawAliveT = fx.clamp(fx.div(fx.fromInt(Math.min(eliminated, aliveDenom)), fx.fromInt(aliveDenom)), 0, fx.ONE);
  // Squared, not sqrt: this must damp small elimination counts *down*
  // relative to the old linear term (early kills barely move it) while
  // still climbing to the cap for a badly-thinned field, not amplify
  // small inputs the way a sqrt curve would. Previously tried sqrt() here
  // and it regressed the EASY-difficulty novice-survival floor in
  // bot.test.ts by making the very first few eliminations push progress
  // (and therefore hazard frequency, via trySpawnHazard's own call to
  // this function) higher than the pre-rework linear term did.
  const dampedAliveT = fx.mul(fx.mul(rawAliveT, rawAliveT), ALIVE_TERM_CAP);
  return fxMaxNum(tickT, dampedAliveT);
}

/** Bounding box of every platform in the arena ('solid' and
 * 'pass-through' alike -- a player can stand on either), plus
 * STANDING_MARGIN. This is "the ground", read from the arena's own data,
 * not a per-stage constant. */
export function computeGroundHalfExtents(arena: ArenaData): BlastRect {
  const platforms = arena.platforms;
  const first = platforms[0];
  let minX = first ? first.minX : arena.blastMinX;
  let maxX = first ? first.maxX : arena.blastMaxX;
  let minY = first ? first.y : arena.blastMinY;
  let maxY = first ? first.y : arena.blastMaxY;
  for (const p of platforms) {
    if ((p.minX as number) < (minX as number)) minX = p.minX;
    if ((p.maxX as number) > (maxX as number)) maxX = p.maxX;
    if ((p.y as number) < (minY as number)) minY = p.y;
    if ((p.y as number) > (maxY as number)) maxY = p.y;
  }
  return {
    minX: fx.sub(minX, STANDING_MARGIN),
    maxX: fx.add(maxX, STANDING_MARGIN),
    minY: fx.sub(minY, STANDING_MARGIN),
    maxY: fx.add(maxY, STANDING_MARGIN),
  };
}

/** Finds the single platform (any kind) that a fully-closed endgame ring
 * should converge on: the one whose x-range actually contains the
 * arena's geometric centre, or -- if none does, e.g. a stage with a gap
 * or a wall straddling the centre line -- the platform whose centre is
 * closest to it. `computeGroundHalfExtents`'s bounding box treats every
 * platform as one contiguous span, which is wrong for stages with a
 * chasm (The Undercroft) or dividing walls (The Foundry): the final ring
 * must never be wider than the one platform survivors can actually stand
 * on together, or two survivors on opposite sides of an unwalkable gap
 * both read as "safe" without ever being forced to fight. */
function findConvergencePlatform(arena: ArenaData): { minX: Fixed; maxX: Fixed } {
  const centerX = fx.div(fx.add(arena.blastMaxX, arena.blastMinX), fx.fromInt(2));
  const platforms = arena.platforms;
  if (platforms.length === 0) return { minX: arena.blastMinX, maxX: arena.blastMaxX };
  const cx = centerX as number;
  for (const p of platforms) {
    if ((p.minX as number) <= cx && cx <= (p.maxX as number)) return { minX: p.minX, maxX: p.maxX };
  }
  let best = platforms[0]!;
  let bestDist = Infinity;
  for (const p of platforms) {
    const mid = ((p.minX as number) + (p.maxX as number)) / 2;
    const dist = Math.abs(mid - cx);
    if (dist < bestDist) {
      bestDist = dist;
      best = p;
    }
  }
  return { minX: best.minX, maxX: best.maxX };
}

/** The floor the boundary must never cross once the field is down to
 * FINAL_RING_FIGHTERS or fewer: enough width for that many fighters to
 * stand side by side, centred on the arena's own centre -- but never
 * wider than the single platform that centre sits on (see
 * findConvergencePlatform), so the ring can never span a chasm or a
 * dividing wall and give survivors on both sides false safety without
 * ever sharing standable ground. Vertical extent is left at the full
 * ground box -- height was never the reported defect and squeezing it
 * risks stranding fighters off every platform. */
function computeMinFinalHalfExtents(arena: ArenaData, ground: BlastRect, ringFighters: number): BlastRect {
  const centerX = fx.div(fx.add(arena.blastMaxX, arena.blastMinX), fx.fromInt(2));
  const desiredHalfW = fx.div(fx.mul(fx.fromInt(ringFighters), SPACE_PER_FIGHTER), fx.fromInt(2));
  const platform = findConvergencePlatform(arena);
  // Half-width of the convergence platform itself (no STANDING_MARGIN --
  // that margin is for keeping the boundary clear of ground while the
  // whole field is alive; here the ring is deliberately meant to close
  // down onto exactly what a platform offers, not slightly beyond it).
  const platformHalfW = fx.div(fx.sub(platform.maxX, platform.minX), fx.fromInt(2));
  const minHalfW = fxMinNum(desiredHalfW, platformHalfW);
  return {
    minX: fx.sub(centerX, minHalfW),
    maxX: fx.add(centerX, minHalfW),
    minY: ground.minY,
    maxY: ground.maxY,
  };
}

/** How many fighters the final ring is sized for: FINAL_RING_FIGHTERS,
 * unless the whole roster is smaller than that -- a 3-player lobby must
 * still end in exactly one survivor, so its final ring has to be smaller
 * than its full roster too (ringFighters < fighterCount always, for any
 * fighterCount >= 2), never "the whole lobby is permanently safe". */
function finalRingFighterCount(fighterCount: number): number {
  return Math.min(FINAL_RING_FIGHTERS, Math.max(1, fighterCount - 1));
}

/** The extents the blast rectangle is never allowed to shrink inside of
 * right now, for this alive count: the full ground box while most of the
 * field is alive, relaxing linearly toward computeMinFinalHalfExtents()
 * as fewer fighters remain. Final ring size and roster size are this one
 * formula, not independent numbers -- including for small lobbies, where
 * the ring is scaled down from fighterCount itself instead of the
 * roster-wide FINAL_RING_FIGHTERS constant. */
export function computeSafeExtents(
  arena: ArenaData,
  aliveCount: number,
  fighterCount: number,
  tick = 0,
  settings: MatchSettings | null = null,
): BlastRect {
  const ground = computeGroundHalfExtents(arena);
  const ringFighters = finalRingFighterCount(fighterCount);
  const minFinal = computeMinFinalHalfExtents(arena, ground, ringFighters);
  const denom = fighterCount > ringFighters ? fighterCount - ringFighters : 1;
  const clampedAlive = Math.max(0, Math.min(aliveCount - ringFighters, denom));
  // t = 1 while alive count is at/above the full roster, 0 once down to
  // ringFighters or fewer. Raised to the 1/4 power (two sqrts) so
  // protection is retained through most of the thinning field and only
  // drops away sharply right at the end -- a handful of early
  // eliminations must not meaningfully relax the ground guarantee (this
  // is what a passive/novice fighter standing near an original spawn
  // point relies on for the early minutes of a match; see
  // packages/sim/test/bot.test.ts's EASY-difficulty novice-survival
  // regression test).
  const frac = fx.div(fx.fromInt(clampedAlive), fx.fromInt(denom));
  let t = fx.sqrt(fx.sqrt(frac));

  // Absolute stalemate override: the population-based protection above
  // guarantees ground is safe for as long as the *whole* field is
  // alive, which is correct but means a match where nobody ever gets
  // eliminated (no combat, no boundary pressure) would otherwise never
  // resolve. Past a long ceiling -- 1.25x the normal
  // shrinkFullyClosedTick schedule, well beyond any measured real match
  // length (110-207s) -- ground protection is allowed to relax on time
  // alone, so every match provably ends even in the total-stalemate
  // case. This does not affect normal play: it only ever bites after
  // the ordinary shrink schedule has already been fully closed for a
  // long while with no resolution.
  //
  // REVISED 2026-09-09 (bot pursuit/finish pass): was 3x, then 2x,
  // *relative to shrinkFullyClosedTick*. Both put the point where
  // relaxation *finishes* beyond this project's own 10-minute regression
  // ceiling (packages/sim/test/arena-shrink.test.ts) -- seed 1003
  // legitimately needed the override and didn't get it in time, failing
  // `npm test`, twice.
  //
  // REVISED A THIRD TIME 2026-09-09 (integration-test regression pass):
  // the 5-minute floor (Math.max(5min, shrinkFullyClosedTick)) below was
  // itself wrong for the opposite direction -- test/dev configs that
  // deliberately set a *tiny* shrinkFullyClosedTick (e.g. server/test/
  // integration.test.ts uses 300 ticks = 5s, to force a fast resolvable
  // match) got the override pinned to 5 minutes regardless, defeating
  // the whole point of a fast-forced config and leaving a 3-player match
  // with no combat stuck relying on ordinary boundary shrink alone.
  // There is no floor needed: staleTick = shrinkFullyClosedTick already
  // satisfies "never relax before the clock-driven term would have
  // fully closed" for every settings value, small or large, because the
  // clock term itself uses the same shrinkFullyClosedTick as its own
  // denominator (see tickDenom above) and reaches full closure exactly
  // then.
  // REVISED AGAIN 2026-09-09 (ring-pacing attribution pass): tying the
  // override's timing to shrinkFullyClosedTick was itself the bug --
  // when the ring-pacing experiment raised shrinkFullyClosedTick from 4
  // to 6 minutes to buy fighters more time to actually fight (see
  // match-settings.ts), the override's 1.25x/2.25x multipliers scaled
  // right along with it and pushed relax-finish out to 13.5 minutes,
  // blowing through the 10-minute test ceiling again (arena-shrink.test
  // seed 1003 hung). The override exists to bound *wall-clock* stalemate
  // time, which has nothing to do with how fast the ordinary ring
  // schedule runs, so it must not scale with shrinkFullyClosedTick at
  // all. Now two absolute tick constants: override starts at 5 minutes
  // (generous next to real observed match durations of 110-207s) and
  // finishes relaxing 4 minutes later, at 9 minutes absolute -- fixed
  // regardless of shrinkFullyClosedTick, comfortably inside the
  // 10-minute test ceiling with a full minute of margin for eliminations
  // to actually occur once the ring is tight.
  //
  // REVISED AGAIN 2026-09-09 (ring-pacing follow-up): a fixed 5-minute
  // start still overlapped the *ordinary* schedule once the ring-pacing
  // experiment raised shrinkFullyClosedTick to 6 minutes -- the override
  // began relaxing ground protection at full alive count a full minute
  // before the normal schedule had even finished closing, breaking the
  // "ground is never swept while the field is full" invariant during
  // completely ordinary play (caught by arena-shrink.test.ts's
  // full-alive-count sweep, which checks every tick up to
  // shrinkFullyClosedTick). The override's job is only to catch a
  // genuine stalemate *after* the ordinary schedule has already run its
  // course, so its start must never be earlier than shrinkFullyClosedTick
  // itself -- start the same instant the ordinary schedule reaches full
  // closure (or 5 minutes, whichever is later), then relax over the next
  // 2 minutes. This tracks shrinkFullyClosedTick additively (a max, not a
  // multiplier), so it can't blow up the way the old 1.25x/2.25x
  // multipliers did.
  const STALEMATE_OVERRIDE_RELAX_TICKS = 60 * 60 * 2; // 2 minutes to fully relax
  if (settings) {
    const staleTick = settings.shrinkFullyClosedTick;
    const timeT = fx.clamp(
      fx.sub(fx.ONE, fx.div(fx.fromInt(Math.max(0, tick - staleTick)), fx.fromInt(STALEMATE_OVERRIDE_RELAX_TICKS))),
      0,
      fx.ONE,
    );
    t = fx.min(t, timeT);
  }
  return {
    minX: lerp(minFinal.minX, ground.minX, t),
    maxX: lerp(minFinal.maxX, ground.maxX, t),
    minY: lerp(minFinal.minY, ground.minY, t),
    maxY: lerp(minFinal.maxY, ground.maxY, t),
  };
}

export function computeCurrentBlastRect(
  arena: ArenaData,
  tick: number,
  aliveCount: number,
  fighterCount: number,
  settings: MatchSettings,
): BlastRect {
  const progress = computeShrinkProgress(tick, aliveCount, fighterCount, settings);
  const halfW = fx.div(fx.sub(arena.blastMaxX, arena.blastMinX), fx.fromInt(2));
  const halfH = fx.div(fx.sub(arena.blastMaxY, arena.blastMinY), fx.fromInt(2));
  const centerX = fx.div(fx.add(arena.blastMaxX, arena.blastMinX), fx.fromInt(2));
  const centerY = fx.div(fx.add(arena.blastMaxY, arena.blastMinY), fx.fromInt(2));

  const safe = computeSafeExtents(arena, aliveCount, fighterCount, tick, settings);
  // The scheduled target for "fully closed" is the population-aware safe
  // floor itself (not a fixed fraction) -- the ring closes exactly down
  // to what's safe for who's left, no further.
  const finalHalfW = fx.div(fx.sub(safe.maxX, safe.minX), fx.fromInt(2));
  const finalHalfH = fx.div(fx.sub(safe.maxY, safe.minY), fx.fromInt(2));
  const curHalfW = lerp(halfW, finalHalfW, progress);
  const curHalfH = lerp(halfH, finalHalfH, progress);

  let minX = fx.sub(centerX, curHalfW);
  let maxX = fx.add(centerX, curHalfW);
  let minY = fx.sub(centerY, curHalfH);
  let maxY = fx.add(centerY, curHalfH);

  // Belt-and-braces clamp to the same safe extents: guards against any
  // future change to the interpolation above ever placing the boundary
  // inside ground a currently-alive-sized field needs.
  minX = fxMinNum(minX, safe.minX);
  maxX = fxMaxNum(maxX, safe.maxX);
  minY = fxMinNum(minY, safe.minY);
  maxY = fxMaxNum(maxY, safe.maxY);

  return { minX, maxX, minY, maxY };
}
