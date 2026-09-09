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
  // Fighter-only bounding box (with padding). This — not a blend with the
  // arena bounds — is what the camera centers on. Blending fighter
  // positions into the arena's own min/max (the old approach) meant a
  // single fighter near one edge only ever pushed that one side out,
  // while the untouched side stayed pinned to the arena bound: the
  // resulting center was dragged off the fighters' actual middle,
  // producing an asymmetric, off-center frame on any stage where the
  // arena itself isn't symmetric around the fighters (see the-spire).
  let fMinX = Infinity;
  let fMaxX = -Infinity;
  let fMinY = Infinity;
  let fMaxY = -Infinity;
  for (const p of positions) {
    fMinX = Math.min(fMinX, p.x - cfg.paddingWorld);
    fMaxX = Math.max(fMaxX, p.x + cfg.paddingWorld);
    fMinY = Math.min(fMinY, p.y - cfg.paddingWorld);
    fMaxY = Math.max(fMaxY, p.y + cfg.paddingWorld * 1.5); // headroom for jumps
  }
  if (positions.length === 0) {
    fMinX = cfg.arena.minX;
    fMaxX = cfg.arena.maxX;
    fMinY = cfg.arena.minY;
    fMaxY = cfg.arena.maxY;
  }

  const fCenterX = (fMinX + fMaxX) / 2;
  const fCenterY = (fMinY + fMaxY) / 2;
  const fSpanX = Math.max(1, fMaxX - fMinX);
  const fSpanY = Math.max(1, fMaxY - fMinY);

  const arenaSpanX = Math.max(1, cfg.arena.maxX - cfg.arena.minX);
  const arenaSpanY = Math.max(1, cfg.arena.maxY - cfg.arena.minY);
  // The view must never be *smaller* than what the arena floor needs, so
  // a couple of fighters standing close together still read as "a fight
  // in an arena" rather than a tight, disorienting zoom. This is a size
  // floor only — it does not pull the center toward the arena's own
  // midpoint.
  const spanX = Math.max(fSpanX, arenaSpanX);
  const spanY = Math.max(fSpanY, arenaSpanY);

  const scaleX = cfg.viewWidth / spanX;
  const scaleY = cfg.viewHeight / spanY;
  let scale = Math.min(scaleX, scaleY);
  const arenaFitScale = Math.min(cfg.viewWidth / arenaSpanX, cfg.viewHeight / arenaSpanY);
  const floor = Math.min(cfg.minScale, arenaFitScale);
  scale = Math.max(floor, Math.min(cfg.maxScale, scale));

  // Center on the fighters, then clamp so the frame doesn't wander past
  // the arena bounds and show dead space beyond them (e.g. show empty
  // blast zone past the edge when the fighters are clustered near it).
  const halfViewWorldX = cfg.viewWidth / 2 / scale;
  const halfViewWorldY = cfg.viewHeight / 2 / scale;
  let centerX = fCenterX;
  let centerY = fCenterY;
  if (cfg.arena.maxX - cfg.arena.minX > halfViewWorldX * 2) {
    centerX = Math.min(Math.max(centerX, cfg.arena.minX + halfViewWorldX), cfg.arena.maxX - halfViewWorldX);
  } else {
    centerX = (cfg.arena.minX + cfg.arena.maxX) / 2;
  }
  if (cfg.arena.maxY - cfg.arena.minY > halfViewWorldY * 2) {
    centerY = Math.min(Math.max(centerY, cfg.arena.minY + halfViewWorldY), cfg.arena.maxY - halfViewWorldY);
  } else {
    centerY = (cfg.arena.minY + cfg.arena.maxY) / 2;
  }

  return { centerX, centerY, scale };
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
