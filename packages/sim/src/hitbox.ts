// Fixed-point AABB overlap for hitbox/hurtbox resolution (Engine
// Architecture section 3). Boxes are axis-aligned; angle on a hitbox only
// affects knockback direction, not its collision shape.
import type { Fixed } from './math/fixed.ts';
import * as fx from './math/fixed.ts';

export interface Box {
  minX: Fixed;
  minY: Fixed;
  maxX: Fixed;
  maxY: Fixed;
}

export function makeBoxCentered(centerX: Fixed, centerY: Fixed, width: Fixed, height: Fixed): Box {
  const halfW = fx.div(width, fx.fromInt(2));
  const halfH = fx.div(height, fx.fromInt(2));
  return {
    minX: fx.sub(centerX, halfW),
    maxX: fx.add(centerX, halfW),
    minY: fx.sub(centerY, halfH),
    maxY: fx.add(centerY, halfH),
  };
}

/** Standard AABB overlap test: true if the boxes intersect (touching edges
 * do not count as overlap). */
export function aabbOverlap(a: Box, b: Box): boolean {
  return a.minX < b.maxX && a.maxX > b.minX && a.minY < b.maxY && a.maxY > b.minY;
}
