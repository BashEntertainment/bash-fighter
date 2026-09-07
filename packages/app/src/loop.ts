// Fixed-timestep accumulator: the sim always advances at exactly 60Hz
// regardless of the browser's render rate (which may be 60/120/144+Hz or
// stutter). Render always runs once per rAF and interpolates between the
// two most recent sim ticks using the leftover accumulator fraction.
export const SIM_HZ = 60;
export const SIM_DT_MS = 1000 / SIM_HZ;
// Cap how many ticks we'll catch up in one frame (e.g. after a tab was
// backgrounded) so a huge stall doesn't freeze the page running thousands
// of sim steps synchronously.
const MAX_TICKS_PER_FRAME = 8;

export class FixedTimestepLoop {
  private accumulatorMs = 0;
  private lastTimeMs: number | null = null;
  private rafHandle = 0;
  private running = false;

  constructor(
    private readonly onTick: () => void,
    private readonly onRender: (alpha: number) => void,
  ) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastTimeMs = null;
    this.accumulatorMs = 0;
    this.rafHandle = requestAnimationFrame(this.frame);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.rafHandle);
  }

  private readonly frame = (nowMs: number): void => {
    if (!this.running) return;
    if (this.lastTimeMs === null) this.lastTimeMs = nowMs;
    let deltaMs = nowMs - this.lastTimeMs;
    this.lastTimeMs = nowMs;
    if (deltaMs > 250) deltaMs = 250; // huge stall (tab backgrounded etc.)

    this.accumulatorMs += deltaMs;
    let ticks = 0;
    while (this.accumulatorMs >= SIM_DT_MS && ticks < MAX_TICKS_PER_FRAME) {
      this.onTick();
      this.accumulatorMs -= SIM_DT_MS;
      ticks++;
    }
    const alpha = Math.min(1, Math.max(0, this.accumulatorMs / SIM_DT_MS));
    this.onRender(alpha);
    this.rafHandle = requestAnimationFrame(this.frame);
  };
}
