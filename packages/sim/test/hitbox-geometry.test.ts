// Regression coverage for the "100x hitbox scale" class of bug: every move
// of every roster character is exercised through the REAL sim.advance()
// loop against a real opponent, not a hand-built hit event. This is the
// test that would have caught hitboxes authored ~100x too small.
//
// Three properties are asserted per move:
//   1. Point-blank in front, facing the opponent -> the move connects.
//   2. Point-blank but BEHIND the attacker -> it must NOT connect (rules
//      out a "hitbox the size of the stage" false pass).
//   3. Far away -> it must NOT connect (range sanity).
// Plus a static geometry sanity check: every hitbox's size/offset must sit
// within a defensible multiple of the character's own hurtbox, so a units
// mistake (e.g. authoring in the wrong scale) fails loudly even if some
// other bug happened to make the connectivity tests above pass.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Sim } from '../src/sim.ts';
import { makeInputFrame, BUTTON_ATTACK } from '../src/types.ts';
import * as fx from '../src/math/fixed.ts';
import { MoveId, moveTotalDuration, type CharacterData, type MoveDef } from '../src/moves/types.ts';
import { ALL_CHARACTERS } from '../../content/src/characters.ts';

// Raw fighter-buffer field offsets, mirrored from sim.ts's private
// FighterField (see packages/sim/test/combat.test.ts's meteor test for the
// precedent of reaching into the buffer directly rather than duplicating
// sim internals).
const F = { POS_X: 0, POS_Y: 1, VEL_X: 2, VEL_Y: 3, STATE: 4, FACING: 5, GROUNDED: 6 };
const FIELD_COUNT = 25; // FighterField.FIELD_COUNT (kept in sync manually; see sim.ts)
const STATE_ATTACK = 5; // FighterStateId.ATTACK — see entities/fighter.ts; avoided importing to keep this test decoupled from state numbering churn, value only used to *not* fight the sim (unused directly here).
void STATE_ATTACK;

const NEUTRAL = makeInputFrame(0, 0, 0);
const AWAY = fx.fromInt(2000); // far enough to be out of range for any sane hitbox

function setFighter(
  sim: Sim,
  index: number,
  opts: { posX: fx.Fixed; posY: fx.Fixed; facing: 1 | -1; grounded: boolean },
): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const d = (sim as any).data as Int32Array;
  const base = index * FIELD_COUNT;
  d[base + F.POS_X] = opts.posX as number;
  d[base + F.POS_Y] = opts.posY as number;
  d[base + F.VEL_X] = 0;
  d[base + F.VEL_Y] = 0;
  d[base + F.FACING] = opts.facing;
  d[base + F.GROUNDED] = opts.grounded ? 1 : 0;
}

/** Input that starts (and, since we re-issue every tick, sustains) the
 * given move: attack button plus the stick position the sim's move-select
 * logic (sim.ts, `wantsAttack` block) needs to disambiguate jab/ftilt or
 * uair/dair. */
function inputFor(moveId: number): ReturnType<typeof makeInputFrame> {
  if (moveId === MoveId.FTILT) return makeInputFrame(BUTTON_ATTACK, fx.fromFloat(1), 0);
  if (moveId === MoveId.DAIR) return makeInputFrame(BUTTON_ATTACK, 0, fx.fromFloat(-1));
  if (moveId === MoveId.UAIR) return makeInputFrame(BUTTON_ATTACK, 0, fx.fromFloat(1));
  return makeInputFrame(BUTTON_ATTACK, 0, 0); // JAB
}

function isAerial(moveId: number): boolean {
  return moveId === MoveId.UAIR || moveId === MoveId.DAIR;
}

/** Bounding box (in attacker-local, facing=1 space) of every hitbox across
 * every window of a move. */
function activeHitboxes(move: MoveDef) {
  return move.windows.flatMap((w) => w.hitboxes);
}

/** Run the move against a defender placed at a fixed offset from the
 * attacker (attacker always at origin, facing right). Returns true if the
 * defender ever took damage while the move played out. */
function runMove(
  character: CharacterData,
  move: MoveDef,
  offsetX: fx.Fixed,
  offsetY: fx.Fixed,
): boolean {
  const sim = new Sim(1, 2, [character, character] as const, undefined, {
    winCondition: 'stocks',
    startingStocks: 3,
  });
  const grounded = !isAerial(move.id);
  const originY = grounded ? fx.fromInt(0) : fx.fromInt(50);
  const attackerPos = { posX: fx.fromInt(0), posY: originY, facing: 1 as const, grounded };
  const total = moveTotalDuration(move);
  let hit = false;
  for (let i = 0; i < total + 2; i++) {
    // Re-pin both fighters every tick so gravity drift on airborne moves
    // (or friction/knockback from an earlier partial hit) never masks a
    // real geometry failure or manufactures a false connect.
    setFighter(sim, 0, attackerPos);
    setFighter(sim, 1, {
      posX: fx.add(attackerPos.posX, offsetX),
      posY: fx.add(attackerPos.posY, offsetY),
      facing: -1,
      grounded,
    });
    sim.advance([inputFor(move.id), NEUTRAL]);
    if (sim.getFighter(1).percent > 0) {
      hit = true;
      break;
    }
  }
  return hit;
}

describe('Hitbox geometry: every move of every character must actually hit an adjacent opponent', () => {
  for (const entry of ALL_CHARACTERS) {
    const character = entry.character;
    for (const move of character.moves) {
      const boxes = activeHitboxes(move);
      if (boxes.length === 0) continue;
      // Use the first active hitbox to build a point-blank placement: put
      // the defender's hurtbox center exactly on the hitbox center. If the
      // hitbox is real-sized this must connect; if it's ~100x too small
      // (the historical bug) it will not, because the defender's own body
      // is centered squarely on where the (tiny) box would be.
      const box = boxes[0]!;

      it(`${entry.id}: ${move.name} connects against a point-blank opponent in front`, () => {
        const hit = runMove(character, move, box.offsetX, box.offsetY);
        assert.ok(
          hit,
          `${entry.id}'s ${move.name} did not connect against an opponent centered on its own authored hitbox offset — this is exactly the class of bug the 100x scale regression caused.`,
        );
      });

      it(`${entry.id}: ${move.name} does NOT connect against an opponent directly behind the attacker`, () => {
        if (box.offsetX === 0) return; // vertical-only moves have no "behind" to test
        const hit = runMove(character, move, fx.neg(box.offsetX), box.offsetY);
        assert.equal(
          hit,
          false,
          `${entry.id}'s ${move.name} hit an opponent standing behind the attacker — hitbox is not directional (could be stage-sized).`,
        );
      });

      it(`${entry.id}: ${move.name} does NOT connect against an opponent far out of range`, () => {
        const hit = runMove(character, move, AWAY, AWAY);
        assert.equal(hit, false, `${entry.id}'s ${move.name} hit an opponent 2000 units away — hitbox has no sane range limit.`);
      });
    }
  }
});

describe('Hitbox geometry sanity band: hitbox size/offset must be proportionate to the character body', () => {
  // Band rationale: this project's hurtboxes are ~16x32 units. A melee
  // fighting-game hitbox that reaches an adjacent opponent and covers a
  // believable strike should be within the same order of magnitude as the
  // body it is attached to, not a different unit scale entirely. We allow
  // generous headroom for range moves (aerials reaching above/below, tilts
  // reaching further out) while still catching an authoring mistake that
  // is 10x+ off in either direction — which is what a ~100x scale bug
  // looks like. Chosen band, relative to hurtboxWidth (the smaller of the
  // two body dimensions, so it's the stricter bound):
  //   - hitbox width/height: between 0.3x and 3x hurtboxWidth
  //   - |offsetX| / |offsetY|: at most 3x hurtboxWidth (a fighter's reach
  //     should not extend multiple body-lengths from its own center)
  const MIN_SIZE_RATIO = 0.3;
  const MAX_SIZE_RATIO = 3.0;
  const MAX_OFFSET_RATIO = 3.0;

  for (const entry of ALL_CHARACTERS) {
    const character = entry.character;
    const unit = fx.toFloat(character.hurtboxWidth);
    for (const move of character.moves) {
      for (const box of activeHitboxes(move)) {
        it(`${entry.id}: ${move.name} hitbox #${box.id} size is within [${MIN_SIZE_RATIO}x, ${MAX_SIZE_RATIO}x] of hurtboxWidth`, () => {
          const w = fx.toFloat(box.width) / unit;
          const h = fx.toFloat(box.height) / unit;
          assert.ok(
            w >= MIN_SIZE_RATIO && w <= MAX_SIZE_RATIO,
            `${entry.id} ${move.name} hitbox width ratio ${w.toFixed(3)} outside band — looks like a units mismatch.`,
          );
          assert.ok(
            h >= MIN_SIZE_RATIO && h <= MAX_SIZE_RATIO,
            `${entry.id} ${move.name} hitbox height ratio ${h.toFixed(3)} outside band — looks like a units mismatch.`,
          );
        });

        it(`${entry.id}: ${move.name} hitbox #${box.id} offset is within ${MAX_OFFSET_RATIO}x of hurtboxWidth`, () => {
          const ox = Math.abs(fx.toFloat(box.offsetX)) / unit;
          const oy = Math.abs(fx.toFloat(box.offsetY)) / unit;
          assert.ok(ox <= MAX_OFFSET_RATIO, `${entry.id} ${move.name} offsetX ratio ${ox.toFixed(3)} exceeds band.`);
          assert.ok(oy <= MAX_OFFSET_RATIO, `${entry.id} ${move.name} offsetY ratio ${oy.toFixed(3)} exceeds band.`);
        });
      }
    }
  }
});
