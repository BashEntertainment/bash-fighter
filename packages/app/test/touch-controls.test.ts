// Regression tests for TouchControls' real multi-pointer handling: the
// thing that was shipped and only ever verified by *clicking* it in a
// desktop browser, which proves nothing about two independent fingers
// down at once (see the touch-controls verification pass, 2026-09-09).
//
// There's no jsdom in this repo (npm registry access is blocked for
// agents here -- see Sim Core Implementation Notes on the wiki) and
// Node has no `document`, so this file builds the tiny slice of DOM
// TouchControls actually touches: element creation, classList,
// addEventListener/dispatchEvent (backed by real Node EventTarget so
// event semantics -- bubbling not needed, but capture/dispatch order is
// -- are genuine, not hand-waved), getBoundingClientRect, and
// setPointerCapture/releasePointerCapture. That last pair is the one
// that matters most: a real touch-capable browser can throw from
// setPointerCapture (stale/invalid pointer id, pointer already up by
// the time the call runs, etc), and this suite includes a fake that
// deliberately throws from it to prove the code tolerates that -- this
// is exactly the bug found live (see below) and fixed in
// touch-controls.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BUTTON_ATTACK, BUTTON_JUMP, BUTTON_SPECIAL } from '@bash-fighter/sim';

class FakeRect {
  left: number;
  top: number;
  width: number;
  height: number;
  constructor(left = 0, top = 0, width = 100, height = 100) {
    this.left = left;
    this.top = top;
    this.width = width;
    this.height = height;
  }
}

class FakeClassList {
  private set = new Set<string>();
  add(...names: string[]): void {
    for (const n of names) this.set.add(n);
  }
  remove(...names: string[]): void {
    for (const n of names) this.set.delete(n);
  }
  contains(name: string): boolean {
    return this.set.has(name);
  }
  toString(): string {
    return [...this.set].join(' ');
  }
}

/** Pointer ids currently "captured" get tracked globally per element so
 * capture calls can be asserted on, and so releasePointerCapture on an
 * id that was never captured (a real thing that can happen) doesn't
 * throw either. */
class FakePointerEvent extends Event {
  pointerId: number;
  clientX: number;
  clientY: number;
  constructor(type: string, init: { pointerId: number; clientX?: number; clientY?: number; bubbles?: boolean; cancelable?: boolean }) {
    super(type, { bubbles: init.bubbles, cancelable: init.cancelable });
    this.pointerId = init.pointerId;
    this.clientX = init.clientX ?? 0;
    this.clientY = init.clientY ?? 0;
  }
}
(globalThis as unknown as { PointerEvent?: unknown }).PointerEvent =
  (globalThis as unknown as { PointerEvent?: unknown }).PointerEvent ?? FakePointerEvent;

class FakeElement extends EventTarget {
  tagName = 'DIV';
  className = '';
  classList = new FakeClassList();
  children: FakeElement[] = [];
  style: Record<string, string> = {};
  dataset: Record<string, string> = {};
  textContent = '';
  rect = new FakeRect();
  capturedPointers = new Set<number>();
  /** Test hook: when set, setPointerCapture throws for this element,
   * simulating what a real browser does for a stale/invalid pointer id. */
  throwOnCapture = false;

  appendChild(child: FakeElement): FakeElement {
    this.children.push(child);
    return child;
  }

  getBoundingClientRect(): FakeRect {
    return this.rect;
  }

  setPointerCapture(pointerId: number): void {
    if (this.throwOnCapture) {
      throw new DOMException('Invalid pointer id', 'InvalidPointerId');
    }
    this.capturedPointers.add(pointerId);
  }

  releasePointerCapture(pointerId: number): void {
    this.capturedPointers.delete(pointerId);
  }
}

function installFakeDom(): { restore: () => void } {
  const g = globalThis as Record<string, unknown>;
  const prevDocument = g.document;
  const prevHTMLDivElement = g.HTMLDivElement;
  g.document = {
    createElement: (_tag: string) => new FakeElement(),
  };
  g.HTMLDivElement = FakeElement;
  return {
    restore(): void {
      g.document = prevDocument;
      g.HTMLDivElement = prevHTMLDivElement;
    },
  };
}


function findButton(buttons: FakeElement[], name: string): FakeElement {
  const btn = buttons.find((b) => b.className.includes(name));
  if (!btn) throw new Error(`test setup: no button found for "${name}"`);
  return btn;
}

function firePointer(
  el: FakeElement,
  type: string,
  opts: { pointerId: number; clientX?: number; clientY?: number },
): void {
  const ev = new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    pointerId: opts.pointerId,
    clientX: opts.clientX ?? 0,
    clientY: opts.clientY ?? 0,
  } as PointerEventInit);
  el.dispatchEvent(ev);
}

async function loadTouchControls() {
  const mod = await import('../src/ui/touch-controls.ts?t=' + Math.random());
  return mod.TouchControls;
}

test('two simultaneous fingers: stick held while a button is tapped both register', async () => {
  const dom = installFakeDom();
  try {
    const TouchControls = await loadTouchControls();
    const parent = new FakeElement();
    const tc = new TouchControls(parent as unknown as HTMLElement);
    const stickBase = (tc as unknown as { stickBase: FakeElement }).stickBase;
    const rootEl = tc.root as unknown as FakeElement;
    const buttonsRow = rootEl.children[1];
    if (!buttonsRow) throw new Error('test setup: expected a second child (buttons row) on TouchControls.root');
    const buttons = buttonsRow.children;
    const jumpBtn = findButton(buttons, 'jump');

    // Finger A: press and hold the stick, dragged right.
    firePointer(stickBase, 'pointerdown', { pointerId: 11, clientX: stickBase.rect.left + 50, clientY: stickBase.rect.top + 50 });
    firePointer(stickBase, 'pointermove', { pointerId: 11, clientX: stickBase.rect.left + 90, clientY: stickBase.rect.top + 50 });

    // Finger B: independently press jump while finger A is still down.
    firePointer(jumpBtn, 'pointerdown', { pointerId: 12 });

    const frame = tc.source.poll();
    assert.ok(frame.stickX > 0, 'stick should read a positive (rightward) value while held');
    assert.ok((frame.buttons & BUTTON_JUMP) !== 0, 'jump bit should be set from the second finger');
    assert.ok(tc.source.isActive(), 'two fingers down should count as active');
  } finally {
    dom.restore();
  }
});

test('setPointerCapture throwing (stale/invalid pointer id) does not lose the press -- regression for the live bug found 2026-09-09', async () => {
  const dom = installFakeDom();
  try {
    const TouchControls = await loadTouchControls();
    const parent = new FakeElement();
    const tc = new TouchControls(parent as unknown as HTMLElement);
    const rootEl = tc.root as unknown as FakeElement;
    const buttonsRow = rootEl.children[1];
    if (!buttonsRow) throw new Error('test setup: expected a second child (buttons row) on TouchControls.root');
    const buttons = buttonsRow.children;
    const attackBtn = findButton(buttons, 'attack');
    attackBtn.throwOnCapture = true;

    firePointer(attackBtn, 'pointerdown', { pointerId: 21 });

    const frame = tc.source.poll();
    assert.ok((frame.buttons & BUTTON_ATTACK) !== 0, 'attack must register even when capture throws');
  } finally {
    dom.restore();
  }
});

test('a finger that drifts outside the stick bounds while held is not stuck -- releasing it clears movement', async () => {
  const dom = installFakeDom();
  try {
    const TouchControls = await loadTouchControls();
    const parent = new FakeElement();
    const tc = new TouchControls(parent as unknown as HTMLElement);
    const stickBase = (tc as unknown as { stickBase: FakeElement }).stickBase;

    firePointer(stickBase, 'pointerdown', { pointerId: 31, clientX: stickBase.rect.left + 50, clientY: stickBase.rect.top + 50 });
    firePointer(stickBase, 'pointermove', { pointerId: 31, clientX: stickBase.rect.left + 5000, clientY: stickBase.rect.top + 5000 });
    let frame = tc.source.poll();
    assert.ok(Math.abs(frame.stickX) > 0 || Math.abs(frame.stickY) > 0, 'far drag should still read a clamped direction, not nothing');

    firePointer(stickBase, 'pointerup', { pointerId: 31 });
    frame = tc.source.poll();
    assert.equal(frame.stickX, 0, 'stick must go back to neutral on release even after drifting far outside bounds');
    assert.equal(frame.stickY, 0);
    assert.ok(!tc.source.isActive(), 'no fingers down after release');
  } finally {
    dom.restore();
  }
});

test('pointercancel (what a real phone sends on an interrupting call/notification) releases the stick instead of leaving it stuck on', async () => {
  const dom = installFakeDom();
  try {
    const TouchControls = await loadTouchControls();
    const parent = new FakeElement();
    const tc = new TouchControls(parent as unknown as HTMLElement);
    const stickBase = (tc as unknown as { stickBase: FakeElement }).stickBase;

    firePointer(stickBase, 'pointerdown', { pointerId: 41, clientX: stickBase.rect.left + 50, clientY: stickBase.rect.top + 50 });
    firePointer(stickBase, 'pointermove', { pointerId: 41, clientX: stickBase.rect.left + 90, clientY: stickBase.rect.top + 50 });
    assert.ok(tc.source.poll().stickX > 0, 'sanity: stick reads non-zero before cancel');

    firePointer(stickBase, 'pointercancel', { pointerId: 41 });

    const frame = tc.source.poll();
    assert.equal(frame.stickX, 0, 'a stuck-on movement input is the worst failure mode -- pointercancel must clear it');
    assert.equal(frame.stickY, 0);
    assert.ok(!tc.source.isActive());
  } finally {
    dom.restore();
  }
});

test('pointercancel on a button clears it -- no permanently-held action button', async () => {
  const dom = installFakeDom();
  try {
    const TouchControls = await loadTouchControls();
    const parent = new FakeElement();
    const tc = new TouchControls(parent as unknown as HTMLElement);
    const rootEl = tc.root as unknown as FakeElement;
    const buttonsRow = rootEl.children[1];
    if (!buttonsRow) throw new Error('test setup: expected a second child (buttons row) on TouchControls.root');
    const buttons = buttonsRow.children;
    const specialBtn = findButton(buttons, 'special');

    firePointer(specialBtn, 'pointerdown', { pointerId: 51 });
    assert.ok((tc.source.poll().buttons & BUTTON_SPECIAL) !== 0);

    firePointer(specialBtn, 'pointercancel', { pointerId: 51 });
    assert.equal(tc.source.poll().buttons & BUTTON_SPECIAL, 0, 'special must not stay held after a cancelled touch');
  } finally {
    dom.restore();
  }
});

test('rapid repeated taps on the same button each register a fresh press', async () => {
  const dom = installFakeDom();
  try {
    const TouchControls = await loadTouchControls();
    const parent = new FakeElement();
    const tc = new TouchControls(parent as unknown as HTMLElement);
    const rootEl = tc.root as unknown as FakeElement;
    const buttonsRow = rootEl.children[1];
    if (!buttonsRow) throw new Error('test setup: expected a second child (buttons row) on TouchControls.root');
    const buttons = buttonsRow.children;
    const jumpBtn = findButton(buttons, 'jump');

    for (let i = 0; i < 10; i++) {
      const pid = 1000 + i;
      firePointer(jumpBtn, 'pointerdown', { pointerId: pid });
      assert.ok((tc.source.poll().buttons & BUTTON_JUMP) !== 0, `tap ${i}: down did not register`);
      firePointer(jumpBtn, 'pointerup', { pointerId: pid });
      assert.equal(tc.source.poll().buttons & BUTTON_JUMP, 0, `tap ${i}: up did not clear`);
    }
  } finally {
    dom.restore();
  }
});

test('two fingers on two different buttons at once both register, and releasing one leaves the other held', async () => {
  const dom = installFakeDom();
  try {
    const TouchControls = await loadTouchControls();
    const parent = new FakeElement();
    const tc = new TouchControls(parent as unknown as HTMLElement);
    const rootEl = tc.root as unknown as FakeElement;
    const buttonsRow = rootEl.children[1];
    if (!buttonsRow) throw new Error('test setup: expected a second child (buttons row) on TouchControls.root');
    const buttons = buttonsRow.children;
    const jumpBtn = findButton(buttons, 'jump');
    const attackBtn = findButton(buttons, 'attack');

    firePointer(jumpBtn, 'pointerdown', { pointerId: 61 });
    firePointer(attackBtn, 'pointerdown', { pointerId: 62 });
    let frame = tc.source.poll();
    assert.ok((frame.buttons & BUTTON_JUMP) !== 0 && (frame.buttons & BUTTON_ATTACK) !== 0, 'both fingers held at once');

    firePointer(jumpBtn, 'pointerup', { pointerId: 61 });
    frame = tc.source.poll();
    assert.equal(frame.buttons & BUTTON_JUMP, 0, 'jump released');
    assert.ok((frame.buttons & BUTTON_ATTACK) !== 0, 'attack finger untouched, still held');
  } finally {
    dom.restore();
  }
});
