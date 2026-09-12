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
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { BUTTON_ATTACK, BUTTON_JUMP, BUTTON_SPECIAL, BUTTON_SHIELD } from '@bash-fighter/sim';

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

// Node has no KeyboardEvent global; same fake-element rationale as
// FakePointerEvent above -- real EventTarget dispatch semantics, only
// the DOM classes are faked (issue #27 keyboard activation tests).
class FakeKeyboardEvent extends Event {
  key: string;
  repeat: boolean;
  constructor(type: string, init: { key: string; repeat?: boolean; bubbles?: boolean; cancelable?: boolean }) {
    super(type, { bubbles: init.bubbles, cancelable: init.cancelable });
    this.key = init.key;
    this.repeat = init.repeat ?? false;
  }
}
(globalThis as unknown as { KeyboardEvent?: unknown }).KeyboardEvent =
  (globalThis as unknown as { KeyboardEvent?: unknown }).KeyboardEvent ?? FakeKeyboardEvent;

function fireKey(el: FakeElement, type: 'keydown' | 'keyup', key: string, opts: { repeat?: boolean } = {}): void {
  const ev = new FakeKeyboardEvent(type, { key, repeat: opts.repeat ?? false, bubbles: true, cancelable: true });
  el.dispatchEvent(ev);
}

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


function getButtonsRow(tc: { root: unknown }): FakeElement {
  const buttonsRow = (tc.root as FakeElement).children[1];
  if (!buttonsRow) throw new Error('test setup: expected a second child (buttons row) on TouchControls.root');
  return buttonsRow;
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

// -- Keyboard accessibility (issue #27): the action buttons are real
// <button> elements now, so Enter/Space on a focused button must drive
// the exact same source state a finger does -- held while the key is
// held (shield is a hold, not a tap), cleared on release.

test('holding Enter on a focused action button holds it, keyup releases it', async () => {
  const dom = installFakeDom();
  try {
    const TouchControls = await loadTouchControls();
    const parent = new FakeElement();
    const tc = new TouchControls(parent as unknown as HTMLElement);
    const shieldBtn = findButton(getButtonsRow(tc).children, 'shield');

    fireKey(shieldBtn, 'keydown', 'Enter');
    assert.ok((tc.source.poll().buttons & BUTTON_SHIELD) !== 0, 'Enter keydown must hold shield like a finger press');

    fireKey(shieldBtn, 'keyup', 'Enter');
    assert.equal(tc.source.poll().buttons & BUTTON_SHIELD, 0, 'Enter keyup must release shield');
    assert.ok(!tc.source.isActive(), 'no pointers down after keyboard release');
  } finally {
    dom.restore();
  }
});

test('Space activates too, and key auto-repeat never double-registers or leaks a stuck press', async () => {
  const dom = installFakeDom();
  try {
    const TouchControls = await loadTouchControls();
    const parent = new FakeElement();
    const tc = new TouchControls(parent as unknown as HTMLElement);
    const attackBtn = findButton(getButtonsRow(tc).children, 'attack');

    fireKey(attackBtn, 'keydown', ' ');
    assert.ok((tc.source.poll().buttons & BUTTON_ATTACK) !== 0, 'Space keydown must hold attack');

    // Holding the key fires repeating keydowns; each must be a no-op so
    // one keyup clears the press cleanly (no duplicate/stuck state).
    for (let i = 0; i < 5; i++) fireKey(attackBtn, 'keydown', ' ', { repeat: true });
    assert.ok((tc.source.poll().buttons & BUTTON_ATTACK) !== 0, 'repeat keydowns must not disturb the held press');

    fireKey(attackBtn, 'keyup', ' ');
    assert.equal(tc.source.poll().buttons & BUTTON_ATTACK, 0, 'one Space keyup must fully clear attack after repeats');
  } finally {
    dom.restore();
  }
});

test('focus leaving while a key is held releases the button -- no stuck-on action (keyboard pointercancel)', async () => {
  const dom = installFakeDom();
  try {
    const TouchControls = await loadTouchControls();
    const parent = new FakeElement();
    const tc = new TouchControls(parent as unknown as HTMLElement);
    const jumpBtn = findButton(getButtonsRow(tc).children, 'jump');

    fireKey(jumpBtn, 'keydown', 'Enter');
    assert.ok((tc.source.poll().buttons & BUTTON_JUMP) !== 0, 'sanity: keyboard press registered');

    // Tab away / focus jumps elsewhere: the keyup would land on another
    // element, so blur must release the held button on its own.
    jumpBtn.dispatchEvent(new Event('blur'));
    assert.equal(tc.source.poll().buttons & BUTTON_JUMP, 0, 'blur while held must release jump');
    assert.ok(!tc.source.isActive(), 'no phantom pointer left active after blur');
  } finally {
    dom.restore();
  }
});

test('a finger and the keyboard can hold the same button; releasing one leaves the other held', async () => {
  const dom = installFakeDom();
  try {
    const TouchControls = await loadTouchControls();
    const parent = new FakeElement();
    const tc = new TouchControls(parent as unknown as HTMLElement);
    const specialBtn = findButton(getButtonsRow(tc).children, 'special');

    firePointer(specialBtn, 'pointerdown', { pointerId: 71 });
    fireKey(specialBtn, 'keydown', 'Enter');
    assert.ok((tc.source.poll().buttons & BUTTON_SPECIAL) !== 0, 'both sources hold special');

    fireKey(specialBtn, 'keyup', 'Enter');
    assert.ok((tc.source.poll().buttons & BUTTON_SPECIAL) !== 0, 'finger still holds special after keyboard release');

    firePointer(specialBtn, 'pointerup', { pointerId: 71 });
    assert.equal(tc.source.poll().buttons & BUTTON_SPECIAL, 0, 'special clears once the last holder lets go');
  } finally {
    dom.restore();
  }
});

test('non-activation keys (Tab, game keys) do not press the button', async () => {
  const dom = installFakeDom();
  try {
    const TouchControls = await loadTouchControls();
    const parent = new FakeElement();
    const tc = new TouchControls(parent as unknown as HTMLElement);
    const attackBtn = findButton(getButtonsRow(tc).children, 'attack');

    for (const key of ['Tab', 'a', 'Shift', 'Escape']) {
      fireKey(attackBtn, 'keydown', key);
      fireKey(attackBtn, 'keyup', key);
    }
    assert.equal(tc.source.poll().buttons, 0, 'only Enter/Space may drive button state');
    assert.ok(!tc.source.isActive());
  } finally {
    dom.restore();
  }
});

// Source pin: the accessibility fix is a real <button type="button">
// element, not a div with role="button" -- the fake DOM above cannot
// see the tag name, so pin the construction directly (same technique
// as ring-damage-and-match-end-audio.test.ts).
const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../src/ui/touch-controls.ts'), 'utf8');

test('makeButton builds a real <button type="button"> (issue #27)', () => {
  assert.match(src, /document\.createElement\('button'\)/, 'action buttons must be real <button> elements');
  assert.match(src, /btn\.type = 'button'/, 'type="button" so Enter/Space/submit semantics stay form-safe');
  assert.doesNotMatch(src, /document\.createElement\('div'\);\s*\n\s*btn\.className = `touch-btn/, 'the old div construction must be gone');
  assert.match(src, /addEventListener\('keydown'/, 'keyboard activation must be wired');
  assert.match(src, /addEventListener\('blur'/, 'blur release must be wired (no stuck-on action)');
});
