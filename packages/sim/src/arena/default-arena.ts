// Minimal single-flat-platform arena, used as Sim's default when no
// ArenaData is supplied (keeps small-N unit tests simple and matches the
// original 2-fighter geometry exactly). Real content (including the
// 20-player arena) lives in packages/content.
import * as fx from '../math/fixed.ts';
import type { ArenaData } from './types.ts';

export const DEFAULT_ARENA: ArenaData = {
  name: 'Default Flat Stage',
  platforms: [{ minX: fx.fromInt(-200), maxX: fx.fromInt(200), y: fx.fromInt(0) }],
  blastMinX: fx.fromInt(-260),
  blastMaxX: fx.fromInt(260),
  blastMinY: fx.fromInt(-120),
  blastMaxY: fx.fromInt(220),
  spawnPoints: [
    { x: fx.fromInt(-30), y: fx.fromInt(0) },
    { x: fx.fromInt(30), y: fx.fromInt(0) },
  ],
};
