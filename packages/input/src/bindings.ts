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

/** All remappable fields on a KeyBinding, in the order the settings UI
 * should list them. Kept separate from BUTTON_FIELDS because the stick
 * directions (left/right/up/down) are also remappable but are not sim
 * "buttons". */
export const BINDING_FIELDS = ['left', 'right', 'up', 'down', 'jump', 'attack', 'special', 'shield'] as const;
export type BindingField = (typeof BINDING_FIELDS)[number];

export const BINDING_FIELD_LABELS: Record<BindingField, string> = {
  left: 'Move left',
  right: 'Move right',
  up: 'Move up',
  down: 'Move down',
  jump: 'Jump',
  attack: 'Attack',
  special: 'Special',
  shield: 'Shield',
};

const STORAGE_KEY = 'bash-fighter:key-bindings';

export interface PersistedBindings {
  p1: KeyBinding;
  p2: KeyBinding;
}

function isValidBinding(v: unknown): v is KeyBinding {
  if (!v || typeof v !== 'object') return false;
  return BINDING_FIELDS.every((f) => typeof (v as Record<string, unknown>)[f] === 'string');
}

/** Reads remapped bindings from localStorage, if any were saved. Returns
 * null (not defaults) when nothing is stored or the stored value is
 * malformed, so callers can tell "no override, use defaults" apart from
 * an actual saved choice. Fails open (returns null) rather than throwing
 * when storage is unavailable (privacy mode etc.), matching the pattern
 * already used by ControlsHint. */
export function loadPersistedBindings(): PersistedBindings | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return null;
    const p1 = (parsed as Record<string, unknown>).p1;
    const p2 = (parsed as Record<string, unknown>).p2;
    if (!isValidBinding(p1) || !isValidBinding(p2)) return null;
    return { p1, p2 };
  } catch {
    return null;
  }
}

export function savePersistedBindings(p1: KeyBinding, p2: KeyBinding): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ p1, p2 }));
  } catch {
    // Storage unavailable -- the rebind still takes effect for this
    // session, it just won't survive a reload. Not worth surfacing as
    // an error to the player.
  }
}

export function clearPersistedBindings(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
