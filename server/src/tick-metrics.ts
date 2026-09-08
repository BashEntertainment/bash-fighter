// Lightweight, always-on tick-timing instrumentation for the authoritative
// match server. Records wall-clock duration of each Match.tickOnce() call
// (sim.advance() + snapshot bookkeeping) across all matches on this process,
// so mean/p99/worst-case cost against the 16.67ms frame budget can be
// measured under real load instead of estimated from a synthetic bench.
// Deliberately cheap: a fixed-size ring buffer, no allocation per sample.

const RING_SIZE = 4096;
const ring = new Float64Array(RING_SIZE);
let count = 0;
let writeIdx = 0;
let max = 0;
let sum = 0;

export function recordTickDurationMs(ms: number): void {
  ring[writeIdx] = ms;
  writeIdx = (writeIdx + 1) % RING_SIZE;
  count++;
  sum += ms;
  if (ms > max) max = ms;
}

export function tickMetricsSnapshot(): {
  sampleCount: number;
  meanMs: number;
  maxMs: number;
  p99Ms: number;
  frameBudgetMs: number;
} {
  const n = Math.min(count, RING_SIZE);
  const sorted = Array.from(ring.slice(0, n)).sort((a, b) => a - b);
  const p99 = n > 0 ? sorted[Math.min(n - 1, Math.floor(n * 0.99))] : 0;
  return {
    sampleCount: count,
    meanMs: n > 0 ? sum / count : 0,
    maxMs: max,
    p99Ms: p99,
    frameBudgetMs: 1000 / 60,
  };
}

export function resetTickMetrics(): void {
  ring.fill(0);
  count = 0;
  writeIdx = 0;
  max = 0;
  sum = 0;
}
