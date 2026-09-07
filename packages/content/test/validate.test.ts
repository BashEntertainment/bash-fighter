// Content schema validator tests (Engine Architecture part 2 section 7).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validateCharacter, assertValidCharacter } from '../src/validate.ts';
import { PLACEHOLDER_CHARACTER } from '../src/characters/placeholder/data.ts';
import type { CharacterData } from '../../sim/src/moves/types.ts';
import { fromInt, fromFloat } from '../../sim/src/math/fixed.ts';

function clone(): CharacterData {
  return JSON.parse(JSON.stringify(PLACEHOLDER_CHARACTER));
}

describe('validateCharacter: the shipped placeholder character', () => {
  it('has no validation errors', () => {
    assert.deepEqual(validateCharacter(PLACEHOLDER_CHARACTER), []);
  });

  it('assertValidCharacter does not throw', () => {
    assert.doesNotThrow(() => assertValidCharacter(PLACEHOLDER_CHARACTER));
  });
});

describe('validateCharacter: error cases', () => {
  it('rejects a non-positive weight', () => {
    const bad = clone();
    bad.weight = 0;
    const errors = validateCharacter(bad);
    assert.ok(errors.some((e) => e.path === 'weight'));
  });

  it('rejects an empty character name', () => {
    const bad = clone();
    bad.name = '   ';
    const errors = validateCharacter(bad);
    assert.ok(errors.some((e) => e.path === 'name'));
  });

  it('rejects a character with no moves', () => {
    const bad = clone();
    bad.moves = [];
    const errors = validateCharacter(bad);
    assert.ok(errors.some((e) => e.path === 'moves'));
  });

  it('rejects duplicate move ids', () => {
    const bad = clone();
    bad.moves[1].id = bad.moves[0].id;
    const errors = validateCharacter(bad);
    assert.ok(errors.some((e) => e.message.includes('duplicate move id')));
  });

  it('rejects a move with zero frame windows', () => {
    const bad = clone();
    bad.moves[0].windows = [];
    const errors = validateCharacter(bad);
    assert.ok(errors.some((e) => e.message.includes('at least one frame window')));
  });

  it('rejects a non-active window that has hitboxes (orphaned hitboxes)', () => {
    const bad = clone();
    bad.moves[0].windows[0].hitboxes = [
      {
        id: 99,
        offsetX: fromInt(0),
        offsetY: fromInt(0),
        width: fromInt(1),
        height: fromInt(1),
        angleIdx: 0,
        damage: fromInt(1),
        baseKnockback: fromInt(1),
        knockbackGrowth: fromInt(0),
        priority: 1,
      },
    ];
    const errors = validateCharacter(bad);
    assert.ok(errors.some((e) => e.message.includes('orphaned hitboxes')));
  });

  it('rejects a window with a non-positive duration', () => {
    const bad = clone();
    bad.moves[0].windows[0].duration = 0;
    const errors = validateCharacter(bad);
    assert.ok(errors.some((e) => e.message.includes('duration must be a positive integer')));
  });

  it('rejects duplicate hitbox ids within the same move', () => {
    const bad = clone();
    const activeWindow = bad.moves[0].windows.find((w: { kind: string }) => w.kind === 'active');
    activeWindow.hitboxes.push({ ...activeWindow.hitboxes[0] });
    const errors = validateCharacter(bad);
    assert.ok(errors.some((e) => e.message.includes('duplicate hitbox id')));
  });

  it('rejects negative damage on a hitbox', () => {
    const bad = clone();
    const activeWindow = bad.moves[0].windows.find((w: { kind: string }) => w.kind === 'active');
    activeWindow.hitboxes[0].damage = -1;
    const errors = validateCharacter(bad);
    assert.ok(errors.some((e) => e.message.includes('damage must be >= 0')));
  });

  it('rejects non-positive hurtbox dimensions', () => {
    const bad = clone();
    bad.hurtboxWidth = 0;
    const errors = validateCharacter(bad);
    assert.ok(errors.some((e) => e.path === 'hurtboxWidth/hurtboxHeight'));
  });

  it('assertValidCharacter throws with all error paths listed', () => {
    const bad = clone();
    bad.weight = -fromFloat(1);
    bad.moves = [];
    assert.throws(() => assertValidCharacter(bad), /invalid character data/);
  });
});
