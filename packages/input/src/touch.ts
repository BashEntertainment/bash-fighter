// On-screen touch controls: a movement stick plus four action buttons,
// producing the exact same InputFrame struct as keyboard/gamepad (part 2
// §5 of the engine doc). No new code path in the sim -- stick magnitude
// already varies continuously (bot wobble does this too, see
// packages/sim/src/ai/bot.ts), so a touch stick's analog value is not a
// new kind of input the sim has to learn to handle.
//
// This module only tracks *state* (which buttons are down, current stick
// vector) from pointer events the UI layer forwards to it. It has no DOM
// of its own -- packages/app owns the actual on-screen elements (visuals,
// layout, the project's look) and calls the setters here as pointers
// move. That split keeps this package free of rendering concerns, same
// as KeyboardSource/gamepad.ts.
import { fixed as fx, makeInputFrame, type InputFrame } from '@bash-fighter/sim';
import { BUTTON_ATTACK, BUTTON_JUMP, BUTTON_SHIELD, BUTTON_SPECIAL } from '@bash-fighter/sim';

export type TouchButton = 'jump' | 'attack' | 'special' | 'shield';

const BUTTON_BY_NAME: Record<TouchButton, number> = {
  jump: BUTTON_JUMP,
  attack: BUTTON_ATTACK,
  special: BUTTON_SPECIAL,
  shield: BUTTON_SHIELD,
};

/** Holds the live state of the on-screen stick + buttons and turns it
 * into an InputFrame on demand. One instance per local slot (in practice
 * only slot 0, the local human, ever gets one -- see InputManager). */
export class TouchSource {
  private stickX = 0;
  private stickY = 0;
  private buttons = 0;
  private activePointers = 0;

  /** Raw stick vector in [-1, 1] on both axes (already clamped/deadzoned
   * by the caller's drag-radius math); converted to fixed-point here so
   * this class, not the UI, is the one place that touches sim types. */
  setStick(x: number, y: number): void {
    const clampedX = Math.max(-1, Math.min(1, x));
    const clampedY = Math.max(-1, Math.min(1, y));
    this.stickX = fx.fromFloat(clampedX);
    this.stickY = fx.fromFloat(clampedY);
  }

  setButton(name: TouchButton, held: boolean): void {
    const bit = BUTTON_BY_NAME[name];
    this.buttons = held ? (this.buttons | bit) : (this.buttons & ~bit);
  }

  /** The UI calls this whenever the count of fingers currently down on
   * any control (stick or button) changes, so isActive() reflects real
   * touch use rather than "was ever shown". */
  setActivePointerCount(count: number): void {
    this.activePointers = count;
  }

  /** True while at least one finger is on a control. Used by
   * InputManager to decide whether touch should override keyboard/
   * gamepad for this slot this frame -- see the module comment on
   * index.ts for why this is a per-frame decision, not a mode switch. */
  isActive(): boolean {
    return this.activePointers > 0;
  }

  poll(): InputFrame {
    return makeInputFrame(this.buttons, this.stickX, this.stickY);
  }

  /** Release everything -- used on visibility change / pointer cancel so
   * a lifted finger never leaves a stuck direction or held button. */
  reset(): void {
    this.stickX = 0;
    this.stickY = 0;
    this.buttons = 0;
    this.activePointers = 0;
  }
}

/** Capability check: is *any* touch input possible on this device at
 * all? Deliberately not a screen-width guess -- large touch laptops
 * exist and phones can have a paired keyboard, so width tells you
 * nothing reliable about whether touch is the right control scheme.
 * `maxTouchPoints` is the standard, widely-supported signal; the
 * `ontouchstart` check is a fallback for older engines that don't set
 * it. */
export function isTouchCapable(nav: Navigator = navigator, win: Window = window): boolean {
  if (typeof nav.maxTouchPoints === 'number' && nav.maxTouchPoints > 0) return true;
  if ('ontouchstart' in win) return true;
  // Test-only override: the automation used to verify touch controls end
  // to end (synthetic PointerEvents dispatched at the live page) runs in
  // a desktop browser engine that reports zero touch points and has no
  // `ontouchstart`, so there is no way to make the real capability check
  // pass without an actual touch-capable device. `?forceTouch=1` lets
  // that harness opt in explicitly and only when asked; it has no effect
  // for real users since nobody adds it to a URL by accident.
  try {
    if (win.location?.search && new URLSearchParams(win.location.search).get('forceTouch') === '1') return true;
  } catch {
    // location access can throw in some sandboxed contexts; ignore.
  }
  return false;
}
