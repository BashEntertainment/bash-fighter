// Frames the arena. The baseline view always shows the whole arena
// (derived from whatever StageBounds/blast-zone data it is given, never a
// hardcoded size) so a match reads as "a fight in an arena" even when
// fighters are standing still near center; it only zooms in tighter when
// fighters spread further apart than the arena's own footprint, and never
// zooms out past maxScale even if a fighter is flying toward the blast
// zone. Same function will frame 2 fighters on today's stage or 20 on a
// much bigger one — it only ever reads positions + bounds, no fighter
// count or stage size baked in.
export interface CameraView {
  centerX: number;
  centerY: number;
  scale: number; // pixels per world unit
}

export interface ArenaBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export interface CameraConfig {
  viewWidth: number;
  viewHeight: number;
  minScale: number;
  maxScale: number;
  paddingWorld: number;
  /** Full arena footprint (typically the blast zone) — the camera never
   * frames tighter than this by default. */
  arena: ArenaBounds;
}

export function computeCamera(
  positions: readonly { x: number; y: number }[],
  cfg: CameraConfig,
): CameraView {
  let minX = cfg.arena.minX;
  let maxX = cfg.arena.maxX;
  let minY = cfg.arena.minY;
  let maxY = cfg.arena.maxY;
  for (const p of positions) {
    minX = Math.min(minX, p.x - cfg.paddingWorld);
    maxX = Math.max(maxX, p.x + cfg.paddingWorld);
    minY = Math.min(minY, p.y - cfg.paddingWorld);
    maxY = Math.max(maxY, p.y + cfg.paddingWorld * 1.5); // headroom for jumps
  }

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
