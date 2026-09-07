// Schema validator for community-contributed character data (Engine
// Architecture part 2 section 7): CI runs the schema validator plus
// frame-data sanity checks on every content PR before it is mergeable.
import type { CharacterData, FrameWindow, MoveDef } from '../../sim/src/moves/types.ts';

export interface ValidationError {
  path: string;
  message: string;
}

function isFinitePositive(n: number): boolean {
  return Number.isFinite(n) && n > 0;
}

function validateWindow(w: FrameWindow, movePath: string, index: number, errors: ValidationError[]): void {
  const path = movePath + '.windows[' + index + ']';
  if (w.kind !== 'startup' && w.kind !== 'active' && w.kind !== 'endlag') {
    errors.push({ path: path + '.kind', message: 'unknown window kind: ' + String(w.kind) });
  }
  if (!Number.isInteger(w.duration) || w.duration < 1) {
    errors.push({ path: path + '.duration', message: 'duration must be a positive integer, got ' + w.duration });
  }
  if (w.kind !== 'active' && w.hitboxes.length > 0) {
    errors.push({ path: path + '.hitboxes', message: 'orphaned hitboxes on a non-active window: ' + w.kind });
  }
  const seenIds = new Set<number>();
  for (let i = 0; i < w.hitboxes.length; i++) {
    const hb = w.hitboxes[i];
    if (!hb) continue;
    const hbPath = path + '.hitboxes[' + i + ']';
    if (seenIds.has(hb.id)) {
      errors.push({ path: hbPath + '.id', message: 'duplicate hitbox id within this move: ' + hb.id });
    }
    seenIds.add(hb.id);
    if (hb.width <= 0 || hb.height <= 0) {
      errors.push({ path: hbPath, message: 'hitbox width/height must be > 0' });
    }
    if (hb.damage < 0) {
      errors.push({ path: hbPath + '.damage', message: 'damage must be >= 0' });
    }
    if (hb.baseKnockback < 0 || hb.knockbackGrowth < 0) {
      errors.push({ path: hbPath, message: 'baseKnockback/knockbackGrowth must be >= 0' });
    }
    if (!Number.isInteger(hb.angleIdx)) {
      errors.push({ path: hbPath + '.angleIdx', message: 'angleIdx must be an integer LUT index' });
    }
  }
}

function validateMove(move: MoveDef, errors: ValidationError[]): void {
  const path = 'moves[' + move.id + '](' + move.name + ')';
  if (!move.name || move.name.trim().length === 0) {
    errors.push({ path: path + '.name', message: 'move name must be non-empty' });
  }
  if (move.windows.length === 0) {
    errors.push({ path: path + '.windows', message: 'move must have at least one frame window' });
    return;
  }
  move.windows.forEach((w, i) => validateWindow(w, path, i, errors));
}

export function validateCharacter(character: CharacterData): ValidationError[] {
  const errors: ValidationError[] = [];
  if (!character.name || character.name.trim().length === 0) {
    errors.push({ path: 'name', message: 'character name must be non-empty' });
  }
  if (!isFinitePositive(character.weight)) {
    errors.push({ path: 'weight', message: 'weight must be a positive fixed-point value, got ' + character.weight });
  }
  if (!isFinitePositive(character.hurtboxWidth) || !isFinitePositive(character.hurtboxHeight)) {
    errors.push({ path: 'hurtboxWidth/hurtboxHeight', message: 'hurtbox dimensions must be > 0' });
  }
  if (character.moves.length === 0) {
    errors.push({ path: 'moves', message: 'character must define at least one move' });
  }
  const seenMoveIds = new Set<number>();
  for (const move of character.moves) {
    if (seenMoveIds.has(move.id)) {
      errors.push({ path: 'moves[' + move.id + ']', message: 'duplicate move id: ' + move.id });
    }
    seenMoveIds.add(move.id);
    validateMove(move, errors);
  }
  return errors;
}

export function assertValidCharacter(character: CharacterData): void {
  const errors = validateCharacter(character);
  if (errors.length > 0) {
    const detail = errors.map((e) => '  - ' + e.path + ': ' + e.message).join('\n');
    throw new Error('invalid character data for ' + character.name + ':\n' + detail);
  }
}
