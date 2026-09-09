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
//
// Revised 2026-09-09 after playing the shipped v1 live: comparing each
// move against the whole roster put nearly every character's moves in
// the same middle bucket ("medium-speed, mid-range, moderate") because
// most characters cluster near the roster average -- three
// near-identical sentences per character taught a reader nothing and
// read as visibly auto-generated. Switched to comparing a move against
// that same character's other three moves instead (see `describe` below),
// and added the actual input for each move, which the first version
// hadn't included at all despite being the most useful single fact in a
// move list -- doubly so now that touch controls exist and a phone
// player can't glance at a keyboard to know what a button does.
import { fixed as fx, moveTotalDuration, MoveId, type CharacterData, type MoveDef } from '@bash-fighter/sim';

export interface MoveReferenceEntry {
  id: number;
  name: string;
  input: string;
  description: string;
  damage: number;
  startup: number;
  totalFrames: number;
}

// Exactly how each move is thrown -- read straight out of the real input
// logic in packages/sim/src/sim.ts (the attack-button branch: grounded +
// neutral stick = jab, grounded + a held direction = forward tilt,
// airborne + neutral/up = up air, airborne + held down = down air). This
// mapping is the same for every character today, so it's written once
// here rather than per character. If a character ever gets its own
// input scheme this needs to move per-character; nothing here assumes
// that yet.
const INPUT_TEXT: Record<number, { keyboard: string; touch: string }> = {
  [MoveId.JAB]: { keyboard: 'F, no direction held, on the ground', touch: 'Attack, no direction, on the ground' },
  [MoveId.FTILT]: { keyboard: 'A or D + F, on the ground', touch: 'Attack while holding a side on the stick, on the ground' },
  [MoveId.UAIR]: { keyboard: 'F in the air, no direction (or up) held', touch: 'Attack in the air, no direction (or up) held' },
  [MoveId.DAIR]: { keyboard: 'S + F, in the air', touch: 'Attack while holding down on the stick, in the air' },
};

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

interface Stat {
  id: number;
  startup: number;
  kb: number;
  reach: number;
}

// Describe a move relative to *that character's own other three moves*,
// not the whole roster. Rationale (see wiki writeup, 2026-09-09 revision):
// comparing against the roster put almost every character's move in the
// same "medium/moderate" middle bucket, since most characters cluster
// near the average -- three near-identical sentences per character
// taught a reader nothing and read as obviously auto-generated. A move
// is genuinely worth calling out when it's the fastest, slowest,
// hardest-hitting, weakest, longest-reaching, or shortest-reaching of
// that *specific* character's four moves -- that's the comparison a
// player actually makes when choosing which button to press. If a move
// isn't the extreme on any axis, we say so plainly instead of forcing an
// adjective that isn't true.
function describe(move: MoveDef, ownStats: Stat[]): string {
  const dmg = damageOf(move);

  const byStartup = [...ownStats].sort((a, b) => a.startup - b.startup);
  const byKb = [...ownStats].sort((a, b) => a.kb - b.kb);
  const byReach = [...ownStats].sort((a, b) => a.reach - b.reach);

  const isExtreme = (sorted: Stat[], id: number, key: keyof Stat): 'min' | 'max' | null => {
    if (sorted.length < 2) return null;
    const first = sorted[0] as Stat;
    const last = sorted[sorted.length - 1] as Stat;
    const second = sorted[1] as Stat;
    const secondLast = sorted[sorted.length - 2] as Stat;
    if (first[key] === last[key]) return null; // all tie, nothing to say
    if (first.id === id && first[key] !== second[key]) return 'min';
    if (last.id === id && last[key] !== secondLast[key]) return 'max';
    return null;
  };

  const notes: string[] = [`${dmg} damage`];

  const speedNote = isExtreme(byStartup, move.id, 'startup');
  if (speedNote === 'min') notes.push('the fastest of the four to come out');
  else if (speedNote === 'max') notes.push('the slowest of the four to come out');

  const kbNote = isExtreme(byKb, move.id, 'kb');
  if (kbNote === 'max') notes.push('hits hardest of the four');
  else if (kbNote === 'min') notes.push('the weakest knockback of the four');

  const reachNote = isExtreme(byReach, move.id, 'reach');
  if (reachNote === 'max') notes.push('the longest reach of the four');
  else if (reachNote === 'min') notes.push('the shortest reach of the four');

  // Every move always states damage; it adds at most the traits that are
  // actually distinctive for it, so a move that isn't extreme on any
  // axis reads as a short, plain, honest line instead of padded filler.
  const [first, ...rest] = notes;
  return rest.length === 0 ? `${first}.` : `${first} -- ${rest.join(', ')}.`;
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function moveReferenceFor(character: CharacterData): MoveReferenceEntry[] {
  const ownStats: Stat[] = character.moves.map((m) => ({
    id: m.id,
    startup: startupOf(m),
    kb: knockbackOf(m),
    reach: reachOf(m),
  }));
  return character.moves.map((m) => {
    const input = INPUT_TEXT[m.id];
    return {
      id: m.id,
      name: m.name,
      input: input ? cap(input.keyboard) + ' (touch: ' + input.touch.charAt(0).toLowerCase() + input.touch.slice(1) + ')' : '',
      description: describe(m, ownStats),
      damage: damageOf(m),
      startup: startupOf(m),
      totalFrames: moveTotalDuration(m),
    };
  });
}
