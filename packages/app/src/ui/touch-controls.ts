// On-screen touch controls: a drag-anywhere movement stick (bottom-left)
// and four action buttons (bottom-right), shown only on touch-capable
// devices and only while the player is actually touching them -- see
// packages/input/src/touch.ts for the InputFrame-producing half of this.
//
// Design rationale (see the touch input design wiki page for the full
// write-up):
//  - One draggable stick beats separate left/right/up/down buttons for
//    movement: a fighting game needs diagonal aerial drift (stickY feeds
//    uair/dair choice and hitstun DI, see packages/sim/src/sim.ts), and a
//    thumb sliding inside a radius is faster and more forgiving under
//    time pressure than hitting four discrete zones.
//  - Four separate buttons beat any gesture for actions: attack/special/
//    shield/jump must be individually and simultaneously pressable
//    (moving while attacking is core to the genre), and a control that
//    can be missed loses the exchange in a fighting game -- so hit
//    targets are large and spaced for thumb error, not screen economy.
//  - Both clusters live in the bottom corners, within one-handed thumb
//    reach on a phone held in landscape or portrait, and stay clear of
//    the upper two-thirds of the screen where the fight actually happens.
import { TouchSource, type TouchButton } from '@bash-fighter/input';

interface StickPointerState {
  pointerId: number;
  originX: number;
  originY: number;
}

const STICK_RADIUS = 52;

export class TouchControls {
  readonly root: HTMLDivElement;
  readonly source = new TouchSource();

  private readonly stickBase: HTMLDivElement;
  private readonly stickNub: HTMLDivElement;
  private stickPointer: StickPointerState | null = null;

  private readonly buttonPointers = new Map<number, TouchButton>();

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.id = 'touch-controls';
    this.root.className = 'hidden';

    this.stickBase = document.createElement('div');
    this.stickBase.className = 'touch-stick-base';
    this.stickNub = document.createElement('div');
    this.stickNub.className = 'touch-stick-nub';
    this.stickBase.appendChild(this.stickNub);
    this.root.appendChild(this.stickBase);

    const buttons = document.createElement('div');
    buttons.className = 'touch-buttons';
    buttons.appendChild(this.makeButton('shield', 'Shield'));
    buttons.appendChild(this.makeButton('special', 'Special'));
    buttons.appendChild(this.makeButton('attack', 'Attack'));
    buttons.appendChild(this.makeButton('jump', 'Jump'));
    this.root.appendChild(buttons);

    parent.appendChild(this.root);
    this.attachStickHandlers();
  }

  show(): void {
    this.root.classList.remove('hidden');
  }

  hide(): void {
    this.root.classList.add('hidden');
    this.reset();
  }

  private reset(): void {
    this.stickPointer = null;
    this.buttonPointers.clear();
    this.stickNub.style.transform = 'translate(0, 0)';
    this.source.reset();
  }

  private updateActiveCount(): void {
    const count = (this.stickPointer ? 1 : 0) + this.buttonPointers.size;
    this.source.setActivePointerCount(count);
  }

  private makeButton(name: TouchButton, label: string): HTMLDivElement {
    const btn = document.createElement('div');
    btn.className = `touch-btn touch-btn-${name}`;
    btn.textContent = label;
    btn.dataset.button = name;
    const onDown = (e: PointerEvent): void => {
      e.preventDefault();
      // setPointerCapture can throw (invalid/stale pointer id, pointer
      // already released between event dispatch and this call, etc). If
      // it throws before the state below is set, the finger's press is
      // silently lost and can leave the button state inconsistent with
      // what's on screen -- worse than not capturing at all. Capture is
      // a nice-to-have (keeps move/up events routed to this element even
      // if the finger drifts outside it); state tracking below is what
      // actually matters, so it must not depend on capture succeeding.
      try {
        btn.setPointerCapture(e.pointerId);
      } catch {
        // Ignored -- see comment above.
      }
      this.buttonPointers.set(e.pointerId, name);
      this.source.setButton(name, true);
      btn.classList.add('pressed');
      this.updateActiveCount();
    };
    const onUp = (e: PointerEvent): void => {
      if (!this.buttonPointers.has(e.pointerId)) return;
      this.buttonPointers.delete(e.pointerId);
      // Only clear the button if no other pointer is still holding it --
      // relevant if a second finger lands on the same button mid-tap.
      const stillHeld = Array.from(this.buttonPointers.values()).includes(name);
      if (!stillHeld) {
        this.source.setButton(name, false);
        btn.classList.remove('pressed');
      }
      this.updateActiveCount();
    };
    btn.addEventListener('pointerdown', onDown);
    btn.addEventListener('pointerup', onUp);
    btn.addEventListener('pointercancel', onUp);
    return btn;
  }

  private attachStickHandlers(): void {
    const onDown = (e: PointerEvent): void => {
      if (this.stickPointer) return; // one finger drives the stick at a time
      e.preventDefault();
      // See the button handler's onDown for why this is guarded the
      // same way: a thrown setPointerCapture must not stop the stick
      // from registering the finger that just pressed it down.
      try {
        this.stickBase.setPointerCapture(e.pointerId);
      } catch {
        // Ignored -- capture is a nice-to-have, not a requirement.
      }
      this.stickPointer = { pointerId: e.pointerId, originX: e.clientX, originY: e.clientY };
      this.updateActiveCount();
    };
    const onMove = (e: PointerEvent): void => {
      if (!this.stickPointer || e.pointerId !== this.stickPointer.pointerId) return;
      e.preventDefault();
      const dx = e.clientX - this.stickPointer.originX;
      const dy = e.clientY - this.stickPointer.originY;
      const mag = Math.hypot(dx, dy);
      const clampedMag = Math.min(mag, STICK_RADIUS);
      const nx = mag > 0 ? (dx / mag) * clampedMag : 0;
      const ny = mag > 0 ? (dy / mag) * clampedMag : 0;
      this.stickNub.style.transform = `translate(${nx}px, ${ny}px)`;
      // Screen Y grows downward; the sim's up is positive Y (see
      // gamepad.ts's own inversion), so flip here too.
      this.source.setStick(nx / STICK_RADIUS, -ny / STICK_RADIUS);
    };
    const onUp = (e: PointerEvent): void => {
      if (!this.stickPointer || e.pointerId !== this.stickPointer.pointerId) return;
      this.stickPointer = null;
      this.stickNub.style.transform = 'translate(0, 0)';
      this.source.setStick(0, 0);
      this.updateActiveCount();
    };
    this.stickBase.addEventListener('pointerdown', onDown);
    this.stickBase.addEventListener('pointermove', onMove);
    this.stickBase.addEventListener('pointerup', onUp);
    this.stickBase.addEventListener('pointercancel', onUp);
  }
}
