// Spectator camera primitives. The renderer stays a dumb painter — the
// app layer owns *when* to follow whom, this module just owns *how* the
// camera gets there smoothly. Exponential smoothing (not a snap, not a
// fixed-duration tween) so it reads well regardless of frame rate or how
// far the target jumped (e.g. cycling between two survivors on opposite
// sides of a big arena).
import type { ArenaBounds, CameraConfig, CameraView } from './camera.ts';
import { computeCamera } from './camera.ts';

export interface FollowConfig {
  viewWidth: number;
  viewHeight: number;
  scale: number;
  /** How far above the fighter's feet the camera centers, in world units. */
  verticalOffset: number;
}

/** A tight camera on a single fighter — used for "follow this survivor". */
export function computeFollowCamera(pos: { x: number; y: number }, cfg: FollowConfig): CameraView {
  return {
    centerX: pos.x,
    centerY: pos.y + cfg.verticalOffset,
    scale: cfg.scale,
  };
}

/** A camera framing every position given plus the live arena bounds —
 * used for "free overview" spectating and as the fallback when there is
 * nobody left to follow. Arena bounds are passed in, not read from a
 * constant, so this tracks a shrinking battle-royale arena automatically. */
export function computeOverviewCamera(
  positions: readonly { x: number; y: number }[],
  arena: ArenaBounds,
  viewWidth: number,
  viewHeight: number,
  minScale: number,
  maxScale: number,
  paddingWorld: number,
): CameraView {
  const cfg: CameraConfig = { viewWidth, viewHeight, minScale, maxScale, paddingWorld, arena };
  return computeCamera(positions, cfg);
}

/** Exponentially smooths a CameraView toward a moving target. Call once
 * per rendered frame with the real elapsed time; independent of tick
 * rate, so it's equally smooth on a stuttering machine or a 240Hz one. */
export class SmoothedCamera {
  current: CameraView;

  constructor(
    initial: CameraView,
    /** Higher = snappier. ~6-10 feels like a deliberate glide; much
     * higher starts to feel like a snap again. */
    private readonly rate = 7,
  ) {
    this.current = { ...initial };
  }

  snapTo(view: CameraView): void {
    this.current = { ...view };
  }

  update(target: CameraView, dtSeconds: number): CameraView {
    const t = 1 - Math.exp(-this.rate * Math.max(0, dtSeconds));
    this.current = {
      centerX: lerp(this.current.centerX, target.centerX, t),
      centerY: lerp(this.current.centerY, target.centerY, t),
      scale: lerp(this.current.scale, target.scale, t),
    };
    return this.current;
  }
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
