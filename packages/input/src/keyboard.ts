// Raw keyboard state tracker: listens once at module scope per instance and
// exposes a plain "is this code held" query. No sim/browser coupling beyond
// KeyboardEvent.code, and it never touches sim modules.
export class KeyboardSource {
  private readonly held = new Set<string>();
  private readonly onDown = (e: KeyboardEvent): void => {
    this.held.add(e.code);
  };
  private readonly onUp = (e: KeyboardEvent): void => {
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
