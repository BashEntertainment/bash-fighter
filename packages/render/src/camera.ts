// Frames both fighters in view with padding, without ever cutting either
// one off screen. World units are sim floats (fixed.toFloat), Y-up;
// screen space is pixels, Y-down, so the Y axis is flipped on projection.
export interface CameraView {
  centerX: number;
  centerY: number;
  scale: number; // pixels per world unit
}

export interface CameraConfig {
  viewWidth: number;
  viewHeight: number;
  minScale: number;
  maxScale: number;
  paddingWorld: number;
}

export function computeCamera(
  positions: readonly { x: number; y: number }[],
  cfg: CameraConfig,
): CameraView {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of positions) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }
  minX -= cfg.paddingWorld;
  maxX += cfg.paddingWorld;
  minY -= cfg.paddingWorld;
  maxY += cfg.paddingWorld * 1.5; // extra headroom above for jumps

  const spanX = Math.max(1, maxX - minX);
  const spanY = Math.max(1, maxY - minY);
  const scaleX = cfg.viewWidth / spanX;
  const scaleY = cfg.viewHeight / spanY;
  let scale = Math.min(scaleX, scaleY);
  scale = Math.max(cfg.minScale, Math.min(cfg.maxScale, scale));

  return {
    centerX: (minX + maxX) / 2,
    centerY: (minY + maxY) / 2,
    scale,
  };
}

/** Convert a world point (Y-up) to screen pixels (Y-down) given a camera
 * and the render surface size. */
export function worldToScreen(
  x: number,
  y: number,
  cam: CameraView,
  viewWidth: number,
  viewHeight: number,
): { x: number; y: number } {
  return {
    x: viewWidth / 2 + (x - cam.centerX) * cam.scale,
    y: viewHeight / 2 - (y - cam.centerY) * cam.scale,
  };
}
