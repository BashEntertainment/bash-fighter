// Deterministic uniform spatial grid broad phase for hitbox/hurtbox
// resolution at fighter counts up to 32 (this task's item 2). Naive
// pairwise checking is already cheap at N<=32 in absolute terms, but the
// point is to *not* rely on it: this grid bounds the candidate set per
// query to nearby cells and, critically, iterates in an order that can
// never depend on object identity, Map/Set hash ordering, or insertion
// order — only ascending fighter index, which is the same rule the rest
// of the sim already follows (Engine Architecture §2).
//
// Everything here is preallocated once per Sim (sized from the fighter
// count) and rebuilt in place every tick with plain index loops — no
// `new`, no array growth, no Map/Set — to stay inside the no-allocation
// hot-path contract.
import type { Fixed } from './math/fixed.ts';
import * as fx from './math/fixed.ts';

/** World-space cell size. Chosen relative to typical hurtbox/hitbox extents
 * (a few fixed-point units) and the arena span (a few hundred units), so a
 * grid comfortably fits in a small fixed array and most queries touch only
 * one or a handful of cells. */
export const CELL_SIZE: Fixed = fx.fromInt(40);
/** Grid covers world X in [-GRID_HALF_SPAN, GRID_HALF_SPAN) and the same in
 * Y; positions outside this range (transiently, e.g. mid-knockback beyond
 * the blast zone right before the blast-zone check removes them) are
 * clamped into the border cell rather than indexed out of bounds. This
 * clamping is itself deterministic (pure function of position), so it does
 * not affect determinism. */
const GRID_HALF_SPAN_CELLS = 12; // covers +/-480 world units
const GRID_DIM = GRID_HALF_SPAN_CELLS * 2; // cells per axis

function axisToCell(pos: Fixed): number {
  const cellsFromZero = fx.toInt(fx.div(pos, CELL_SIZE)); // floor toward zero, fine for bucketing
  const idx = cellsFromZero + GRID_HALF_SPAN_CELLS;
  if (idx < 0) return 0;
  if (idx >= GRID_DIM) return GRID_DIM - 1;
  return idx;
}

export class SpatialGrid {
  private readonly numCells = GRID_DIM * GRID_DIM;
  private readonly cellOfEntity: Int32Array; // per entity slot, -1 if excluded this tick
  private readonly cellCount: Int32Array; // per cell, reset each build
  private readonly cellStart: Int32Array; // prefix sum, length numCells+1
  private readonly bucket: Int32Array; // entity indices grouped by cell, length capacity
  private readonly visitedGen: Int32Array; // per entity, last query generation that visited it
  private generation = 0;
  private readonly capacity: number;

  constructor(capacity: number) {
    this.capacity = capacity;
    this.cellOfEntity = new Int32Array(capacity).fill(-1);
    this.cellCount = new Int32Array(this.numCells);
    this.cellStart = new Int32Array(this.numCells + 1);
    this.bucket = new Int32Array(capacity);
    this.visitedGen = new Int32Array(capacity).fill(-1);
  }

  /** Rebuild the grid for this tick from entity center positions. `active`
   * flags let dead/eliminated fighters be excluded without resizing
   * anything. Deterministic counting sort: two passes over ascending
   * entity index, no comparator, no Map/Set. */
  build(
    count: number,
    getX: (i: number) => Fixed,
    getY: (i: number) => Fixed,
    isActive: (i: number) => boolean,
  ): void {
    this.cellCount.fill(0);
    for (let i = 0; i < count; i++) {
      if (!isActive(i)) {
        this.cellOfEntity[i] = -1;
        continue;
      }
      const cx = axisToCell(getX(i));
      const cy = axisToCell(getY(i));
      const cell = cy * GRID_DIM + cx;
      this.cellOfEntity[i] = cell;
      this.cellCount[cell] = (this.cellCount[cell] as number) + 1;
    }
    let acc = 0;
    for (let c = 0; c < this.numCells; c++) {
      this.cellStart[c] = acc;
      acc += this.cellCount[c] as number;
    }
    this.cellStart[this.numCells] = acc;
    // Second pass: place each entity at the next free slot in its cell's
    // range. Iterating i ascending means entities land in ascending index
    // order within a cell — deterministic, independent of any hashing.
    const cursor = this.cellCount; // reuse as a per-cell write cursor (cellCount no longer needed after prefix sum)
    cursor.fill(0);
    for (let i = 0; i < count; i++) {
      const cell = this.cellOfEntity[i] as number;
      if (cell < 0) continue;
      const slot = (this.cellStart[cell] as number) + (cursor[cell] as number);
      this.bucket[slot] = i;
      cursor[cell] = (cursor[cell] as number) + 1;
    }
    this.generation = (this.generation + 1) | 0;
  }

  /** Call `visit(entityIndex)` once for every entity whose cell overlaps
   * the given world-space box, in deterministic ascending-index order,
   * with no duplicate visits even if the box spans multiple cells. */
  queryBox(minX: Fixed, minY: Fixed, maxX: Fixed, maxY: Fixed, visit: (entityIndex: number) => void): void {
    const cxMin = axisToCell(minX);
    const cxMax = axisToCell(maxX);
    const cyMin = axisToCell(minY);
    const cyMax = axisToCell(maxY);
    this.generation = (this.generation + 1) | 0;
    const gen = this.generation;
    for (let cy = cyMin; cy <= cyMax; cy++) {
      const rowBase = cy * GRID_DIM;
      for (let cx = cxMin; cx <= cxMax; cx++) {
        const cell = rowBase + cx;
        const start = this.cellStart[cell] as number;
        const end = this.cellStart[cell + 1] as number;
        for (let s = start; s < end; s++) {
          const entity = this.bucket[s] as number;
          if (this.visitedGen[entity] === gen) continue; // seen via another overlapping cell this query
          this.visitedGen[entity] = gen;
          visit(entity);
        }
      }
    }
  }
}
