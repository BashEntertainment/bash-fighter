import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_P1_BINDING, DEFAULT_P2_BINDING, type KeyBinding } from '@bash-fighter/input';
import { SettingsPanel } from '../src/ui/settings-panel.ts';

class FakeClassList {
  private readonly names = new Set<string>();

  add(...names: string[]): void {
    for (const name of names) this.names.add(name);
  }

  remove(...names: string[]): void {
    for (const name of names) this.names.delete(name);
  }

  contains(name: string): boolean {
    return this.names.has(name);
  }
}

class FakeElement extends EventTarget {
  className = '';
  classList = new FakeClassList();
  children: FakeElement[] = [];
  textContent = '';
  checked = false;
  type = '';
  private readonly selectors = new Map<string, FakeElement>();

  appendChild(child: FakeElement): FakeElement {
    this.children.push(child);
    return child;
  }

  querySelector(selector: string): FakeElement | null {
    return this.selectors.get(selector) ?? null;
  }

  set innerHTML(_value: string) {
    this.children = [];
    this.selectors.clear();
    for (const selector of [
      '.settings-list',
      '.move-reference-close',
      '.settings-reset-btn',
      '.settings-reduced-motion-checkbox',
    ]) {
      this.selectors.set(selector, new FakeElement());
    }
  }
}

function installFakeDom(): { restore: () => void } {
  const globals = globalThis as Record<string, unknown>;
  const previous = {
    document: globals.document,
    window: globals.window,
    HTMLDivElement: globals.HTMLDivElement,
    HTMLButtonElement: globals.HTMLButtonElement,
    HTMLInputElement: globals.HTMLInputElement,
  };
  globals.document = { createElement: () => new FakeElement() };
  globals.window = new EventTarget();
  globals.HTMLDivElement = FakeElement;
  globals.HTMLButtonElement = FakeElement;
  globals.HTMLInputElement = FakeElement;
  return {
    restore(): void {
      Object.assign(globals, previous);
    },
  };
}

function keydown(code: string): Event {
  const event = new Event('keydown', { cancelable: true });
  Object.defineProperty(event, 'code', { value: code });
  return event;
}

function bindingButton(panel: SettingsPanel, slot: 0 | 1, fieldIndex: number): FakeElement {
  const list = panel.root.querySelector('.settings-list') as unknown as FakeElement;
  const group = list.children[slot];
  if (!group) throw new Error('test setup: missing player binding group');
  const row = group.children[fieldIndex + 1];
  if (!row) throw new Error('test setup: missing binding row');
  const button = row.children[1];
  if (!button) throw new Error('test setup: missing binding button');
  return button;
}

function clone(binding: KeyBinding): KeyBinding {
  return { ...binding };
}

test('rebinding to a same-player key clears only the existing same-player binding', () => {
  const dom = installFakeDom();
  try {
    const changes: Array<{ slot: 0 | 1; binding: KeyBinding }> = [];
    const panel = new SettingsPanel(
      new FakeElement() as unknown as HTMLElement,
      { p1: clone(DEFAULT_P1_BINDING), p2: clone(DEFAULT_P2_BINDING), reducedMotion: false },
      { onBindingChange: (slot, binding) => changes.push({ slot, binding: clone(binding) }), onReducedMotionChange: () => {} },
    );

    bindingButton(panel, 0, 5).dispatchEvent(new Event('click'));
    (window as EventTarget).dispatchEvent(keydown('KeyA'));

    assert.deepEqual(panel.current().p1.left, '');
    assert.equal(panel.current().p1.attack, 'KeyA');
    assert.deepEqual(changes, [{ slot: 0, binding: panel.current().p1 }]);
  } finally {
    dom.restore();
  }
});

test('rebinding Player 1 may reuse a Player 2 key without clearing Player 2', () => {
  const dom = installFakeDom();
  try {
    const panel = new SettingsPanel(
      new FakeElement() as unknown as HTMLElement,
      { p1: clone(DEFAULT_P1_BINDING), p2: clone(DEFAULT_P2_BINDING), reducedMotion: false },
      { onBindingChange: () => {}, onReducedMotionChange: () => {} },
    );

    bindingButton(panel, 0, 5).dispatchEvent(new Event('click'));
    (window as EventTarget).dispatchEvent(keydown('ArrowLeft'));

    assert.equal(panel.current().p1.attack, 'ArrowLeft');
    assert.equal(panel.current().p2.left, 'ArrowLeft');
  } finally {
    dom.restore();
  }
});

test('Escape cancels a capture without changing bindings', () => {
  const dom = installFakeDom();
  try {
    const changes: KeyBinding[] = [];
    const panel = new SettingsPanel(
      new FakeElement() as unknown as HTMLElement,
      { p1: clone(DEFAULT_P1_BINDING), p2: clone(DEFAULT_P2_BINDING), reducedMotion: false },
      { onBindingChange: (_slot, binding) => changes.push(clone(binding)), onReducedMotionChange: () => {} },
    );

    bindingButton(panel, 0, 5).dispatchEvent(new Event('click'));
    (window as EventTarget).dispatchEvent(keydown('Escape'));

    assert.deepEqual(panel.current(), { p1: DEFAULT_P1_BINDING, p2: DEFAULT_P2_BINDING });
    assert.deepEqual(changes, []);
  } finally {
    dom.restore();
  }
});
