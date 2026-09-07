// Remappable keyboard bindings for local multiplayer. Two independent
// bindings (P1: WASD-style, P2: arrows) map physical keys to sim buttons
// and stick axes. Gamepads use a fixed, non-remappable layout (standard
// gamepad mapping) since analog stick + face buttons need no remapping.
import { BUTTON_ATTACK, BUTTON_JUMP, BUTTON_SHIELD, BUTTON_SPECIAL } from '@bash-fighter/sim';

export interface KeyBinding {
  left: string;
  right: string;
  up: string;
  down: string;
  jump: string;
  attack: string;
  special: string;
  shield: string;
}

export const DEFAULT_P1_BINDING: KeyBinding = {
  left: 'KeyA',
  right: 'KeyD',
  up: 'KeyW',
  down: 'KeyS',
  jump: 'Space',
  attack: 'KeyF',
  special: 'KeyG',
  shield: 'ShiftLeft',
};

export const DEFAULT_P2_BINDING: KeyBinding = {
  left: 'ArrowLeft',
  right: 'ArrowRight',
  up: 'ArrowUp',
  down: 'ArrowDown',
  jump: 'Slash',
  attack: 'Comma',
  special: 'Period',
  shield: 'ShiftRight',
};

export const BUTTON_FIELDS = ['jump', 'attack', 'special', 'shield'] as const;

export const BUTTON_BY_FIELD: Record<(typeof BUTTON_FIELDS)[number], number> = {
  jump: BUTTON_JUMP,
  attack: BUTTON_ATTACK,
  special: BUTTON_SPECIAL,
  shield: BUTTON_SHIELD,
};

export function cloneBinding(b: KeyBinding): KeyBinding {
  return { ...b };
}
