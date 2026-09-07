// packages/input: translates raw browser input (keyboard + Gamepad API)
// into the sim's InputFrame struct for two local players. Each player's
// slot is either a keyboard binding or a connected gamepad; gamepads take
// priority over keyboard for a slot once connected, matching the "either
// replaceable by a gamepad" requirement.
import { fixed as fx, makeInputFrame, type InputFrame } from '@bash-fighter/sim';
import { BUTTON_BY_FIELD, BUTTON_FIELDS, DEFAULT_P1_BINDING, DEFAULT_P2_BINDING, type KeyBinding } from './bindings.ts';
import { KeyboardSource } from './keyboard.ts';
import { pollGamepad, listConnectedGamepads } from './gamepad.ts';

export type { KeyBinding } from './bindings.ts';
export { DEFAULT_P1_BINDING, DEFAULT_P2_BINDING, cloneBinding } from './bindings.ts';
export { listConnectedGamepads } from './gamepad.ts';

export interface PlayerSlotConfig {
  binding: KeyBinding;
  /** Gamepad index to prefer for this slot, or null for keyboard-only. */
  gamepadIndex: number | null;
}

function keyboardFrame(kb: KeyboardSource, binding: KeyBinding): InputFrame {
  let buttons = 0;
  for (const field of BUTTON_FIELDS) {
    if (kb.isHeld(binding[field])) buttons |= BUTTON_BY_FIELD[field];
  }
  let stickX = 0;
  let stickY = 0;
  if (kb.isHeld(binding.left)) stickX = fx.sub(stickX, fx.ONE);
  if (kb.isHeld(binding.right)) stickX = fx.add(stickX, fx.ONE);
  if (kb.isHeld(binding.down)) stickY = fx.sub(stickY, fx.ONE);
  if (kb.isHeld(binding.up)) stickY = fx.add(stickY, fx.ONE);
  return makeInputFrame(buttons, stickX, stickY);
}

/** Owns the keyboard listener and per-slot config for two local players,
 * and produces one InputFrame per slot per app frame. */
export class InputManager {
  private readonly keyboard = new KeyboardSource();
  // Local slots are an array, not a fixed pair: this milestone plays 2
  // local humans, but nothing here assumes exactly 2 — a future local
  // multi-controller session (or a networked FFA where only your own
  // slot is local) just changes how many entries this holds.
  readonly slots: PlayerSlotConfig[] = [
    { binding: DEFAULT_P1_BINDING, gamepadIndex: 0 },
    { binding: DEFAULT_P2_BINDING, gamepadIndex: 1 },
  ];

  attach(target: Window = window): void {
    this.keyboard.attach(target);
    target.addEventListener('blur', () => this.keyboard.reset());
  }

  detach(target: Window = window): void {
    this.keyboard.detach(target);
  }

  setBinding(slot: number, binding: KeyBinding): void {
    (this.slots[slot] as PlayerSlotConfig).binding = binding;
  }

  setGamepadIndex(slot: number, gamepadIndex: number | null): void {
    (this.slots[slot] as PlayerSlotConfig).gamepadIndex = gamepadIndex;
  }

  /** Which connected gamepads are currently unassigned to any slot, useful
   * for a "press a button to claim a controller" prompt in the UI. */
  unassignedGamepads(): number[] {
    const assigned = new Set(this.slots.map((s) => s.gamepadIndex).filter((i): i is number => i !== null));
    return listConnectedGamepads().filter((i) => !assigned.has(i));
  }

  /** Poll both slots for the current app frame. Call once per rendered
   * frame; the app layer samples the latest returned pair on each fixed
   * 60Hz sim tick (poll-and-hold, not per-tick re-polling of the DOM). */
  poll(): InputFrame[] {
    return this.slots.map((_, i) => this.pollSlot(i));
  }

  private pollSlot(slot: number): InputFrame {
    const cfg = this.slots[slot] as PlayerSlotConfig;
    if (cfg.gamepadIndex !== null) {
      const pad = pollGamepad(cfg.gamepadIndex);
      if (pad) return pad;
    }
    return keyboardFrame(this.keyboard, cfg.binding);
  }
}
