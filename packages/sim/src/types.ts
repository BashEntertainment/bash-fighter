// Per-frame input struct (part 2 §5): the only thing advance() consumes.
// Packs into plain numbers so it can be logged as a replay, sent over the
// network, and hashed — never raw DOM/Gamepad events.
import type { Fixed } from './math/fixed.ts';

export const BUTTON_JUMP = 1 << 0;
export const BUTTON_ATTACK = 1 << 1;
export const BUTTON_SPECIAL = 1 << 2;
export const BUTTON_SHIELD = 1 << 3;

export interface InputFrame {
  /** Bitfield of BUTTON_* flags. */
  buttons: number;
  /** Stick X axis, Q16.16, range [-ONE, ONE]. */
  stickX: Fixed;
  /** Stick Y axis, Q16.16, range [-ONE, ONE]. */
  stickY: Fixed;
}

export function makeInputFrame(
  buttons = 0,
  stickX: Fixed = 0,
  stickY: Fixed = 0,
): InputFrame {
  return { buttons, stickX, stickY };
}
