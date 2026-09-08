// A one-line reminder of the controls, shown briefly at the start of a
// player's first match only (the start screen already lists keys, but
// reading them once before clicking Play is not the same as knowing them
// the moment a fight starts). Not a tutorial: no steps, no dismiss-to-
// continue gate, just a few seconds of quiet text that fades on its own.
const STORAGE_KEY = 'bash-fighter:seen-controls-hint';
const VISIBLE_MS = 4500;
const FADE_MS = 600;

export class ControlsHint {
  private readonly el: HTMLDivElement;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.id = 'controls-hint';
    this.el.className = 'controls-hint hidden';
    this.el.textContent = 'WASD move · Space jump · F attack · G special · Shift shield';
    parent.appendChild(this.el);
  }

  /** Call once per match start. No-ops after the first time it has ever
   * shown (tracked in localStorage), so returning players are never
   * nagged by it. */
  maybeShow(): void {
    let seen = false;
    try {
      seen = localStorage.getItem(STORAGE_KEY) === '1';
    } catch {
      // localStorage unavailable (privacy mode etc.) -- fail open and just
      // show it once this session rather than throwing.
    }
    if (seen) return;
    try {
      localStorage.setItem(STORAGE_KEY, '1');
    } catch {
      /* ignore */
    }
    this.show();
  }

  private show(): void {
    if (this.timer) clearTimeout(this.timer);
    this.el.classList.remove('hidden', 'fading');
    this.timer = setTimeout(() => {
      this.el.classList.add('fading');
      this.timer = setTimeout(() => this.el.classList.add('hidden'), FADE_MS);
    }, VISIBLE_MS);
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    this.el.classList.add('hidden');
  }
}
