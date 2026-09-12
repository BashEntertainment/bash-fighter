// Raw keyboard state tracker: listens once at module scope per instance and
// exposes a plain "is this code held" query. No sim/browser coupling beyond
// KeyboardEvent.code, and it never touches sim modules.
//
// Focus correctness (issue #35): the game's real interactive controls (mute,
// Controls, Moves, the touch action buttons, settings/move-reference panel
// buttons) are plain <button> elements so they stay in the tab order and
// keep default browser semantics -- that is deliberate, see touch-controls.ts.
// But because this class listens on `window`, a key pressed while one of
// those buttons has focus used to be read twice: once by the browser as a
// button activation (Enter/Space activate a focused button by spec) and
// once here as a raw game input (Space defaults to Jump). The fix is not to
// blur buttons on activation -- that would defeat tabbing and hide focus
// from keyboard users, actively harming accessibility for no gain. Instead,
// this only ignores events whose target is itself a focusable form control:
// the browser's own activation still fires (so Space/Enter on a focused
// button still presses it, no regression there), but the same keystroke no
// longer also reaches the game as a movement/action input. A key with focus
// resting on the game surface (the body, canvas, or any non-control element)
// is completely unaffected and drives the game exactly as before.
const FOCUSABLE_CONTROL_TAGS = new Set(['BUTTON', 'INPUT', 'SELECT', 'TEXTAREA']);

// Duck-typed on purpose, not `target instanceof HTMLElement`: this file has
// no DOM lib dependency beyond KeyboardEvent, and staying duck-typed keeps
// it testable under plain Node (see packages/input/test/keyboard.test.ts),
// matching the fake-DOM pattern used elsewhere in this repo (there is no
// jsdom here -- see touch-controls.test.ts).
function isFocusableControl(target: EventTarget | null): boolean {
  const el = target as { tagName?: string; isContentEditable?: boolean } | null;
  if (!el || typeof el.tagName !== 'string') return false;
  if (FOCUSABLE_CONTROL_TAGS.has(el.tagName)) return true;
  return el.isContentEditable === true;
}

export class KeyboardSource {
  private readonly held = new Set<string>();
  private readonly onDown = (e: KeyboardEvent): void => {
    if (isFocusableControl(e.target)) return;
    this.held.add(e.code);
  };
  private readonly onUp = (e: KeyboardEvent): void => {
    // Always process key-up even if the target looks like a control: if a
    // key was let through on keydown (game surface had focus) and the user
    // then tabs before releasing, the code must still be cleared or it
    // would ghost-hold forever -- same reasoning as reset() below.
    this.held.delete(e.code);
  };

  attach(target: Window = window): void {
    target.addEventListener('keydown', this.onDown);
    target.addEventListener('keyup', this.onUp);
  }

  detach(target: Window = window): void {
    target.removeEventListener('keydown', this.onDown);
    target.removeEventListener('keyup', this.onUp);
  }

  isHeld(code: string): boolean {
    return this.held.has(code);
  }

  /** Release everything — used when the window loses focus so a key stuck
   * "down" during an alt-tab doesn't ghost-hold a direction forever. */
  reset(): void {
    this.held.clear();
  }
}
