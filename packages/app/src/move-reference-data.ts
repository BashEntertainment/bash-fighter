// Move reference copy, generated from the roster's own numbers.
//
// Decision (see the accessibility/move-reference wiki page for the full
// writeup): CharacterData/MoveDef (packages/sim) carries only frame
// numbers -- no human-readable description field, and this task's brief
// keeps packages/sim off limits entirely. Two ways to get player-facing
// copy: add a `description` field to packages/content's data files, or
// compute the description in the UI layer from numbers that are already
// fully expressive. We chose the UI layer, deliberately:
//   - the numbers (damage, startup frames, base knockback) already say
//     everything a description would say -- "fast" means low startup,
//     "hits hard" means high damage/knockback -- so a hand-written
//     description field would just be prose duplicating data that
//     already exists, with the two able to silently drift apart as
//     characters get rebalanced;
//   - it keeps packages/content purely about simulation-affecting
//     numbers, and all presentation/copy in packages/app, which is this
//     project's existing boundary (content has no UI-string fields
//     anywhere else either);
//   - it means a future character or a rebalance never requires someone
//     to remember to also update descriptive prose -- the description
//     regenerates from whatever the numbers are that day.
// The tradeoff, stated honestly: hand-written copy could capture a
// move's "feel" (a read, a mixup, a kill confirm) that raw numbers can't.
// If playtesting finds these descriptions read as generic, that's the
// signal to revisit and add authored copy to packages/content instead.
import { ALL_CHARACTERS } from '@bash-fighter/content';
import { fixed as fx, moveTotalDuration, type CharacterData, type MoveDef } from '@bash-fighter/sim';

export interface MoveReferenceEntry {
  id: number;
  name: string;
  description: string;
  damage: number;
  startup: number;
  totalFrames: number;
}

function startupOf(move: MoveDef): number {
  return move.windows.find((w) => w.kind === 'startup')?.duration ?? 0;
}

function damageOf(move: MoveDef): number {
  const active = move.windows.find((w) => w.kind === 'active');
  const hb = active?.hitboxes[0];
  return hb ? fx.toFloat(hb.damage) : 0;
}

function knockbackOf(move: MoveDef): number {
  const active = move.windows.find((w) => w.kind === 'active');
  const hb = active?.hitboxes[0];
  return hb ? fx.toFloat(hb.baseKnockback) + fx.toFloat(hb.knockbackGrowth) * 20 : 0;
}

function reachOf(move: MoveDef): number {
  const active = move.windows.find((w) => w.kind === 'active');
  const hb = active?.hitboxes[0];
  if (!hb) return 0;
  return Math.abs(fx.toFloat(hb.offsetX)) + Math.abs(fx.toFloat(hb.offsetY)) + fx.toFloat(hb.width) / 2;
}

// Roster-wide stats per move id, computed once, used to say "fast" or
// "slow" relative to the cast rather than an arbitrary absolute cutoff --
// the same move name (Jab, Forward Tilt, Up Air, Down Air) exists on all
// eight characters today, so "fast jab" only means something next to the
// other seven jabs.
function rosterStatsByMoveId(): Map<number, { startup: number[]; damage: number[]; kb: number[]; reach: number[] }> {
  const map = new Map<number, { startup: number[]; damage: number[]; kb: number[]; reach: number[] }>();
  for (const entry of ALL_CHARACTERS) {
    for (const move of entry.character.moves) {
      const s = map.get(move.id) ?? { startup: [], damage: [], kb: [], reach: [] };
      s.startup.push(startupOf(move));
      s.damage.push(damageOf(move));
      s.kb.push(knockbackOf(move));
      s.reach.push(reachOf(move));
      map.set(move.id, s);
      }
  }
  return map;
}

const ROSTER_STATS = rosterStatsByMoveId();

function tertile(value: number, values: number[]): 'low' | 'mid' | 'high' {
  const sorted = [...values].sort((a, b) => a - b);
  const lo = sorted[Math.floor(sorted.length / 3)] ?? value;
  const hi = sorted[Math.floor((sorted.length * 2) / 3)] ?? value;
  if (value <= lo) return 'low';
  if (value >= hi) return 'high';
  return 'mid';
}

const SPEED_WORD: Record<'low' | 'mid' | 'high', string> = { low: 'fast', mid: 'medium-speed', high: 'slow' };
const POWER_WORD: Record<'low' | 'mid' | 'high', string> = { low: 'weak', mid: 'moderate', high: 'strong' };
const REACH_WORD: Record<'low' | 'mid' | 'high', string> = { low: 'short-range', mid: 'mid-range', high: 'long-reach' };

function describe(move: MoveDef): string {
  const stats = ROSTER_STATS.get(move.id);
  const startup = startupOf(move);
  const dmg = damageOf(move);
  const kb = knockbackOf(move);
  const reach = reachOf(move);
  const speed = stats ? SPEED_WORD[tertile(startup, stats.startup)] : 'medium-speed';
  const power = stats ? POWER_WORD[tertile(kb, stats.kb)] : 'moderate';
  const range = stats ? REACH_WORD[tertile(reach, stats.reach)] : 'mid-range';
  const dirWord =
    move.id === 2 ? 'above you' : move.id === 3 ? 'below you' : 'in front of you';
  return `${cap(speed)}, ${range} hit ${dirWord} — ${dmg} damage, ${power} knockback.`;
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function moveReferenceFor(character: CharacterData): MoveReferenceEntry[] {
  return character.moves.map((m) => ({
    id: m.id,
    name: m.name,
    description: describe(m),
    damage: damageOf(m),
    startup: startupOf(m),
    totalFrames: moveTotalDuration(m),
  }));
}
