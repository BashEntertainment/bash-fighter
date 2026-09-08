// Owns spectator camera policy: which survivor to follow (or free
// overview), cycling between survivors, and handing the render package's
// SmoothedCamera a fresh target every frame so motion is eased rather
// than snapped. This is the "client side" of spectate-on-death: it reads
// a MatchAdapter and a live fighter-position list, and produces a
// CameraView the renderer paints verbatim via RenderFrame.cameraOverride.
import {
  computeFollowCamera,
  computeOverviewCamera,
  SmoothedCamera,
  type ArenaBounds,
  type CameraView,
} from '@bash-fighter/render';
import type { MatchAdapter } from './types.ts';

export type SpectatorMode = 'follow' | 'overview';

export interface SpectatorFrameInput {
  positions: readonly { x: number; y: number }[]; // indexed like the sim
  viewWidth: number;
  viewHeight: number;
  arena: ArenaBounds;
  dtSeconds: number;
}

const FOLLOW_SCALE = 4.5;
const FOLLOW_VERTICAL_OFFSET = 8;
const OVERVIEW_MIN_SCALE = 1.6;
const OVERVIEW_MAX_SCALE = 5.5;
const OVERVIEW_PADDING = 20;

export class SpectatorController {
  private mode: SpectatorMode = 'follow';
  private followIndex: number | null = null;
  private readonly camera: SmoothedCamera;
  private active = false;

  constructor(
    private readonly adapter: MatchAdapter,
    /** The local slot spectating (excluded from follow/cycle targets). */
    private readonly localIndex: number,
    initialView: CameraView,
  ) {
    this.camera = new SmoothedCamera(initialView);
  }

  get isActive(): boolean {
    return this.active;
  }

  get currentMode(): SpectatorMode {
    return this.mode;
  }

  get followedIndex(): number | null {
    return this.followIndex;
  }

  /** Called once, the frame the local player is eliminated. */
  activate(): void {
    if (this.active) return;
    this.active = true;
    this.mode = 'follow';
    this.followIndex = this.pickInitialTarget();
  }

  deactivate(): void {
    this.active = false;
    this.followIndex = null;
  }

  toggleOverview(): void {
    this.mode = this.mode === 'overview' ? 'follow' : 'overview';
    if (this.mode === 'follow' && this.followIndex === null) {
      this.followIndex = this.pickInitialTarget();
    }
  }

  /** Cycle to the next surviving fighter (wraps around). */
  cycleNext(): void {
    const survivors = this.adapter.survivorIndices().filter((i) => i !== this.localIndex);
    if (survivors.length === 0) {
      this.followIndex = null;
      return;
    }
    this.mode = 'follow';
    const currentPos = this.followIndex === null ? -1 : survivors.indexOf(this.followIndex);
    const next = survivors[(currentPos + 1 + survivors.length) % survivors.length];
    this.followIndex = next ?? null;
  }

  private pickInitialTarget(): number | null {
    const survivors = this.adapter.survivorIndices().filter((i) => i !== this.localIndex);
    return survivors.length > 0 ? (survivors[0] as number) : null;
  }

  /** Compute this frame's smoothed camera. Safe to call with zero
   * survivors (falls back to framing the whole arena). */
  update(input: SpectatorFrameInput): CameraView {
    // Keep the follow target valid if it was eliminated since last frame.
    if (this.followIndex !== null && this.adapter.status(this.followIndex).eliminated) {
      this.followIndex = this.pickInitialTarget();
    }

    let target: CameraView;
    if (this.mode === 'follow' && this.followIndex !== null && input.positions[this.followIndex]) {
      target = computeFollowCamera(input.positions[this.followIndex] as { x: number; y: number }, {
        viewWidth: input.viewWidth,
        viewHeight: input.viewHeight,
        scale: FOLLOW_SCALE,
        verticalOffset: FOLLOW_VERTICAL_OFFSET,
      });
    } else {
      const survivorPositions = this.adapter
        .survivorIndices()
        .map((i) => input.positions[i])
        .filter((p): p is { x: number; y: number } => p !== undefined);
      target = computeOverviewCamera(
        survivorPositions,
        input.arena,
        input.viewWidth,
        input.viewHeight,
        OVERVIEW_MIN_SCALE,
        OVERVIEW_MAX_SCALE,
        OVERVIEW_PADDING,
      );
    }
    return this.camera.update(target, input.dtSeconds);
  }
}
