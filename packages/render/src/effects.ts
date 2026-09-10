// Presentation-only impact feedback: hit flashes, directional impact
// pops/sparks, and screen shake. Everything here is driven by wall-clock
// render time (performance.now()/rAF delta), never sim ticks -- it reads
// sim state but never influences it, and never touches the fixed 60Hz
// advance() cadence. See EffectsLayer.spawnHit/spawnElimination/shake.
import { Container, Graphics } from 'pixi.js';
import { PALETTE } from './palette.ts';

export interface HitEffectInput {
  /** Screen-space contact point (already camera-transformed). */
  x: number;
  y: number;
  /** Unit-ish knockback direction in screen space (y flips like screen
   * coords: caller should pass already screen-oriented dir). */
  dirX: number;
  dirY: number;
  /** 0..1 normalized hit strength, used to scale every visual. */
  strength: number;
}

interface Particle {
  g: Graphics;
  vx: number;
  vy: number;
  ageMs: number;
  lifeMs: number;
  size: number;
}

interface Pop {
  g: Graphics;
  ageMs: number;
  lifeMs: number;
  baseScale: number;
}

const SPARK_COLOR = PALETTE.danger;
const POP_COLOR = PALETTE.hud;

// Reduced-motion accessibility switch. Screen shake is the one effect
// here with a real vestibular-discomfort/motion-sickness risk (the
// camera itself moving, not just something on screen), so it's what
// this toggle targets -- hit flashes, sparks and pops are untouched
// since they don't move the camera and carry the actual hit-feedback
// information a player needs. Module-level (not per-EffectsLayer)
// because the app can hold more than one Renderer/EffectsLayer (local
// + online) and a single settings toggle must affect all of them
// without threading the flag through every constructor.
let shakeScale = 1;

/** Scale (or fully silence) screen shake app-wide. Called once from
 * main.ts at startup (from the persisted/OS `prefers-reduced-motion`
 * default) and again whenever the player flips the Settings toggle. */
export function setReducedMotion(reduced: boolean): void {
  shakeScale = reduced ? 0 : 1;
}

export function isReducedMotion(): boolean {
  return shakeScale === 0;
}

/** How long (ms) and how strongly a fighter's body should stay tinted
 * after taking a hit -- read by the app/renderer per fighter index. */
const FLASH_BASE_MS = 90;
const FLASH_STRONG_MS = 170;

export class EffectsLayer {
  readonly root = new Container();
  private readonly particleLayer = new Container();
  private readonly popLayer = new Container();
  private particles: Particle[] = [];
  private pops: Pop[] = [];

  // Per-fighter-index flash timers (index -> remaining ms + total ms for
  // fraction). Cleared automatically as they decay; a fighter that never
  // gets hit again just never appears here.
  private flashRemainingMs = new Map<number, number>();
  private flashTotalMs = new Map<number, number>();

  // Screen shake state: an offset applied by the caller to the world
  // container's position. Multiple hits in the same short window are
  // damped (added in quadrature-ish, capped) rather than summed linearly,
  // so a busy 20-fighter brawl does not vibrate permanently.
  private shakeMagnitude = 0; // current px amplitude
  private shakeDecayPerMs = 0.012; // amplitude lost per ms
  private shakeSeed = 1;

  constructor() {
    this.root.addChild(this.particleLayer);
    this.root.addChild(this.popLayer);
  }

  /** Register (or refresh) a hit flash for a fighter. `strong` picks the
   * longer of the two flash durations -- called with the same boolean the
   * audio layer uses to pick hit_heavy vs hit_light/medium, so visual and
   * audio weight always agree. */
  flashFighter(fighterIndex: number, strong: boolean): void {
    const ms = strong ? FLASH_STRONG_MS : FLASH_BASE_MS;
    this.flashRemainingMs.set(fighterIndex, ms);
    this.flashTotalMs.set(fighterIndex, ms);
  }

  /** 0..1, how "flashed" this fighter currently is (1 = just hit, 0 =
   * normal colour). Renderer multiplies this into the sprite's tint. */
  flashAmount(fighterIndex: number): number {
    const remaining = this.flashRemainingMs.get(fighterIndex);
    const total = this.flashTotalMs.get(fighterIndex);
    if (!remaining || !total) return 0;
    return Math.max(0, remaining / total);
  }

  /** Spawn the contact-point spark + directional pop for a hit. Strength
   * (0..1, already computed by the caller from knockback magnitude)
   * scales particle count, size, and travel distance so a heavy hit is
   * unmistakably bigger than a jab. */
  spawnHit(input: HitEffectInput): void {
    const strength = Math.max(0, Math.min(1, input.strength));
    const sparkCount = 3 + Math.round(strength * 6);
    for (let i = 0; i < sparkCount; i++) {
      const g = new Graphics();
      const size = 1.5 + strength * 2.5 + Math.random() * 1.5;
      g.circle(0, 0, size);
      g.fill({ color: SPARK_COLOR });
      g.position.set(input.x, input.y);
      this.particleLayer.addChild(g);
      const spread = (Math.random() - 0.5) * 1.4;
      const speed = (2 + strength * 6) * (0.6 + Math.random() * 0.8);
      const dx = input.dirX + spread;
      const dy = input.dirY + spread;
      const len = Math.hypot(dx, dy) || 1;
      this.particles.push({
        g,
        vx: (dx / len) * speed,
        vy: (dy / len) * speed,
        ageMs: 0,
        lifeMs: 160 + strength * 140,
        size,
      });
    }

    // Directional "smear" pop: a short stretched shape along the
    // knockback direction, bigger/longer for stronger hits.
    const pop = new Graphics();
    const len = 8 + strength * 28;
    const thickness = 3 + strength * 4;
    const angle = Math.atan2(input.dirY, input.dirX);
    pop.roundRect(-len / 2, -thickness / 2, len, thickness, thickness / 2);
    pop.fill({ color: POP_COLOR, alpha: 0.85 });
    pop.position.set(input.x, input.y);
    pop.rotation = angle;
    this.popLayer.addChild(pop);
    this.pops.push({ g: pop, ageMs: 0, lifeMs: 120 + strength * 80, baseScale: 1 });

    this.addShake(strength);
  }

  /** A bigger, screen-anchored moment for an elimination: a bright ring
   * pop at the fighter's last position and a stronger shake. Kept flat
   * and geometric -- no glow/bloom -- per the project's visual language. */
  spawnElimination(x: number, y: number): void {
    const ring = new Graphics();
    ring.circle(0, 0, 6);
    ring.stroke({ color: PALETTE.danger, width: 4 });
    ring.position.set(x, y);
    this.popLayer.addChild(ring);
    this.pops.push({ g: ring, ageMs: 0, lifeMs: 380, baseScale: 1 });
    this.addShake(1, /* eliminationBoost */ 1.5);
  }

  /** Quadrature-ish combine so simultaneous hits (common with 20
   * fighters) approach a cap instead of summing linearly into nausea. */
  private addShake(strength: number, boost = 1): void {
    if (shakeScale === 0) return;
    const add = (3 + strength * 10) * boost * shakeScale;
    this.shakeMagnitude = Math.min(22, Math.sqrt(this.shakeMagnitude * this.shakeMagnitude + add * add));
  }

  /** Advance all timers/particles by `dtMs` of wall-clock render time.
   * Returns the current shake offset to apply to the world container. */
  update(dtMs: number): { x: number; y: number } {
    for (const [idx, remaining] of this.flashRemainingMs) {
      const next = remaining - dtMs;
      if (next <= 0) this.flashRemainingMs.delete(idx);
      else this.flashRemainingMs.set(idx, next);
    }

    this.particles = this.particles.filter((p) => {
      p.ageMs += dtMs;
      if (p.ageMs >= p.lifeMs) {
        p.g.destroy();
        return false;
      }
      const t = p.ageMs / p.lifeMs;
      p.g.x += p.vx * (dtMs / 16.6667);
      p.g.y += p.vy * (dtMs / 16.6667);
      p.g.alpha = 1 - t;
      p.g.scale.set(1 - 0.4 * t);
      return true;
    });

    this.pops = this.pops.filter((p) => {
      p.ageMs += dtMs;
      if (p.ageMs >= p.lifeMs) {
        p.g.destroy();
        return false;
      }
      const t = p.ageMs / p.lifeMs;
      p.g.alpha = (1 - t) * 0.9;
      p.g.scale.set(p.baseScale * (1 + t * 1.6));
      return true;
    });

    if (this.shakeMagnitude > 0.05) {
      this.shakeMagnitude = Math.max(0, this.shakeMagnitude - this.shakeDecayPerMs * dtMs * 60);
    } else {
      this.shakeMagnitude = 0;
    }

    if (this.shakeMagnitude <= 0) return { x: 0, y: 0 };
    // Cheap deterministic-ish jitter (visual only -- does not need to be
    // reproducible/synced across clients).
    this.shakeSeed = (this.shakeSeed * 1103515245 + 12345) & 0x7fffffff;
    const r1 = (this.shakeSeed % 1000) / 1000 - 0.5;
    this.shakeSeed = (this.shakeSeed * 1103515245 + 12345) & 0x7fffffff;
    const r2 = (this.shakeSeed % 1000) / 1000 - 0.5;
    return { x: r1 * 2 * this.shakeMagnitude, y: r2 * 2 * this.shakeMagnitude };
  }
}
