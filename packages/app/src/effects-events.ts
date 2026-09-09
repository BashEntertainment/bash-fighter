// Observes sim state (via FighterSnapshot diffs the app layer already
// takes for the HUD/stock-lost callbacks) and turns it into presentation
// events: hits, blocks, eliminations, item pickups/uses, and match-flow
// milestones (final two, victory). This is the one place that decides
// "something worth feeling just happened" -- the renderer and audio
// layer only ever react to what comes out of here.
//
// Deliberately reads snapshots only, never sim internals: it must work
// identically whether fed from a local Match's per-tick snapshots or from
// NetMatch's server-confirmed snapshots, and it must never be the thing
// that causes a duplicate/phantom sound during client-side prediction --
// callers achieve that by only calling detect() with *confirmed* state
// (see net-match.ts, which calls this from handleBinary on the
// server snapshot, not from the per-tick local prediction advance()).
import { fixed as fx, FighterStateId, type FighterSnapshot, type ItemSnapshot } from '@bash-fighter/sim';

export type EffectEvent =
  | { type: 'hit'; fighterIndex: number; strength: number; strong: boolean; medium: boolean; damage: number; dirX: number; dirY: number }
  | { type: 'block'; fighterIndex: number }
  | { type: 'eliminated'; fighterIndex: number }
  | { type: 'itemPickup'; fighterIndex: number }
  | { type: 'itemUse'; slot: number }
  | { type: 'jump'; fighterIndex: number }
  | { type: 'finalTwo' }
  | { type: 'victory'; fighterIndex: number };

// Knockback magnitudes for the placeholder character's four moves run
// roughly 3-19 (see the Combat Model wiki page); percent-gain-per-hit is a
// robust, cheap proxy for "how hard was that" that works for items and
// hazards too (which don't share a knockback formula path here). These
// thresholds were picked by eye against that range, not derived from a
// formula -- revisit once there's more than one character.
const DAMAGE_LIGHT_MAX = 5; // Fixed-point damage delta this-or-below => light
const DAMAGE_MEDIUM_MAX = 9;

function damageToStrength(damageDelta: number): number {
  // Normalize against the heaviest known move (10 dmg) with generous
  // headroom for items (Bash Bomb is 18) so nothing clips silently.
  return Math.max(0, Math.min(1, damageDelta / 18));
}

function countAlive(snapshots: readonly FighterSnapshot[], numFighters: number): number {
  let alive = 0;
  for (let i = 0; i < numFighters; i++) {
    const f = snapshots[i];
    if (f && !f.eliminated) alive++;
  }
  return alive;
}

/** Diffs two fighter-snapshot arrays for the same numFighters and
 * produces the events that happened between them. Callers own dedup: for
 * a local per-tick loop, call every tick; for a server-confirmed stream,
 * call once per received snapshot with the last-confirmed and current
 * snapshot pair (never with predicted/rolled-back state). */
export function detectFighterEvents(
  prev: readonly FighterSnapshot[],
  curr: readonly FighterSnapshot[],
  numFighters: number,
): EffectEvent[] {
  const events: EffectEvent[] = [];
  for (let i = 0; i < numFighters; i++) {
    const p = prev[i];
    const c = curr[i];
    if (!p || !c) continue;

    const damageDelta = fx.toFloat(c.percent) - fx.toFloat(p.percent);
    const shieldDelta = fx.toFloat(p.shieldHealth) - fx.toFloat(c.shieldHealth);

    if (c.state === FighterStateId.SHIELD && shieldDelta > 0.01) {
      events.push({ type: 'block', fighterIndex: i });
    } else if (damageDelta > 0.05) {
      const strength = damageToStrength(damageDelta);
      const strong = damageDelta > DAMAGE_MEDIUM_MAX;
      const medium = !strong && damageDelta > DAMAGE_LIGHT_MAX;
      // Direction: knockback launches away from the attacker; we don't
      // know the attacker here, so use the fighter's own velocity delta
      // as the visual direction proxy -- it points the way the hit sent
      // them, which is what the effect should show regardless of who hit
      // them (works for hazards/items with no "attacker" concept too).
      const dirX = fx.toFloat(c.velX) - fx.toFloat(p.velX);
      const dirY = fx.toFloat(c.velY) - fx.toFloat(p.velY);
      const len = Math.hypot(dirX, dirY) || 1;
      events.push({
        type: 'hit',
        fighterIndex: i,
        strength,
        strong,
        medium,
        damage: damageDelta,
        dirX: dirX / len,
        dirY: dirY / len,
      });
    }

    const wasEliminated = p.eliminated;
    const isEliminated = c.eliminated;
    if (!wasEliminated && isEliminated) {
      events.push({ type: 'eliminated', fighterIndex: i });
    }

    // Jump takeoff: grounded -> airborne with upward velocity and no
    // damage this tick (a launch from being hit is already covered by the
    // 'hit' event above and shouldn't also chirp a jump sound).
    if (p.grounded && !c.grounded && fx.toFloat(c.velY) > 0.5 && damageDelta <= 0.05) {
      events.push({ type: 'jump', fighterIndex: i });
    }

    // Victory: this fighter's placement just resolved to 1st (winner).
    if (p.placement !== 1 && c.placement === 1) {
      events.push({ type: 'victory', fighterIndex: i });
    }
  }

  // Final two: alive count just dropped from >2 to exactly 2. Only
  // meaningful for matches that started with more than 2 fighters (a
  // 1v1 match is "final two" from tick zero -- not a milestone worth a
  // sound there).
  if (numFighters > 2) {
    const aliveBefore = countAlive(prev, numFighters);
    const aliveAfter = countAlive(curr, numFighters);
    if (aliveBefore > 2 && aliveAfter === 2) {
      events.push({ type: 'finalTwo' });
    }
  }

  return events;
}

/** Same idea for items: a pickup (world/thrown -> held) or a use/explosion
 * (armed item's fuse reaching the end, i.e. active -> inactive while it
 * had been armed). Kept separate from fighter events because items index
 * by slot, not fighter. */
export function detectItemEvents(
  prev: readonly ItemSnapshot[],
  curr: readonly ItemSnapshot[],
  maxItems: number,
): EffectEvent[] {
  const HELD = 1;
  const ARMED = 3;
  const events: EffectEvent[] = [];
  for (let i = 0; i < maxItems; i++) {
    const p = prev[i];
    const c = curr[i];
    if (!p || !c) continue;
    if (c.state === HELD && p.state !== HELD && c.holder >= 0) {
      events.push({ type: 'itemPickup', fighterIndex: c.holder });
    }
    if (p.state === ARMED && (!c.active || c.state !== ARMED)) {
      events.push({ type: 'itemUse', slot: i });
    }
  }
  return events;
}
