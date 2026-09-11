// Regression tests for issue #15: SettingsPanel.handleCapture has a
// deliberate, non-obvious rule with no coverage -- when a player rebinds
// an action to a key already used by another action *for the same
// player*, the old field is silently cleared ("swapped off"). This also
// covers the adjacent Escape-cancels-capture behaviour.
//
// No jsdom in this repo (npm registry access is blocked for agents --
// see "Sim Core Implementation Notes" on the wiki), so this builds the
// small slice of DOM SettingsPanel actually needs: element creation,
// className/classList, a tiny innerHTML parser for the panel's fixed
// template, querySelector(single class selector), and real Node
// EventTarget/Event for addEventListener/dispatchEvent -- following the
// hand-rolled-fake-DOM pattern in touch-controls.test.ts, extended with
// an innerHTML parser since SettingsPanel builds its shell that way.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_P1_BINDING, DEFAULT_P2_BINDING, cloneBinding } from '@bash-fighter/input';

class FakeClassList {
  private readonly el: FakeElement;
  constructor(el: FakeElement) {
    this.el = el;
  }
  private get set(): Set<string> {
    return new Set(this.el.className.split(/\s+/).filter(Boolean));
  }
  private write(s: Set<string>): void {
    this.el.className = [...s].join(' ');
  }
  add(...names: string[]): void {
    const s = this.set;
    for (const n of names) s.add(n);
    this.write(s);
  }
  remove(...names: string[]): void {
    const s = this.set;
    for (const n of names) s.delete(n);
    this.write(s);
  }
  contains(name: string): boolean {
    return this.set.has(name);
  }
}

class FakeElement extends EventTarget {
  tagName: string;
  className = '';
  id = '';
  type = '';
  value = '';
  checked = false;
  children: FakeElement[] = [];
  private _textContent = '';
  classList = new FakeClassList(this);

  constructor(tagName: string) {
    super();
    this.tagName = tagName.toUpperCase();
  }

  get textContent(): string {
    return this._textContent;
  }
  set textContent(v: string) {
    this._textContent = v;
    this.children = [];
  }

  appendChild(child: FakeElement): FakeElement {
    this.children.push(child);
    return child;
  }

  set innerHTML(html: string) {
    this.children = parseHtml(html);
  }

  querySelector(selector: string): FakeElement | null {
    if (!selector.startsWith('.')) throw new Error(`unsupported selector: ${selector}`);
    const cls = selector.slice(1);
    const stack = [...this.children];
    while (stack.length) {
      const el = stack.shift()!;
      if (el.classList.contains(cls)) return el;
      stack.push(...el.children);
    }
    return null;
  }
}

/** Minimal recursive-descent parser for the small, fixed HTML vocabulary
 * SettingsPanel's template uses (div/button/label/span/input, class/
 * type/aria-label/min/max/step attributes, no nesting beyond a few
 * levels). Not a general HTML parser -- just enough of one. */
function parseHtml(html: string): FakeElement[] {
  const VOID_TAGS = new Set(['input']);
  const tagRe = /<(\/?)(\w+)((?:\s+[\w-]+(?:="[^"]*")?)*)\s*\/?>|([^<]+)/g;
  const root = new FakeElement('root');
  const stack: FakeElement[] = [root];
  let match: RegExpExecArray | null;
  while ((match = tagRe.exec(html))) {
    const [, closing, tag, attrsRaw, text] = match;
    const top = stack[stack.length - 1]!;
    if (text !== undefined) {
      const trimmed = text.trim();
      if (trimmed) top.appendChild(Object.assign(new FakeElement('#text'), { textContent: trimmed }));
      continue;
    }
    if (closing) {
      if (stack.length > 1) stack.pop();
      continue;
    }
    const el = new FakeElement(tag ?? 'div');
    const attrRe = /([\w-]+)(?:="([^"]*)")?/g;
    let attrMatch: RegExpExecArray | null;
    while ((attrMatch = attrRe.exec(attrsRaw ?? ''))) {
      const [, name, value] = attrMatch;
      if (name === 'class') el.className = value ?? '';
      else if (name === 'type') el.type = value ?? '';
    }
    top.appendChild(el);
    if (!VOID_TAGS.has(tag ?? '')) stack.push(el);
  }
  return root.children;
}

function installFakeDom(): { restore: () => void } {
  const g = globalThis as Record<string, unknown>;
  const prev = { document: g.document, window: g.window };
  g.document = { createElement: (tag: string) => new FakeElement(tag) };
  g.window = new EventTarget();
  return {
    restore(): void {
      g.document = prev.document;
      g.window = prev.window;
    },
  };
}

async function withPanel(
  fn: (ctx: {
    panel: import('../src/ui/settings-panel.ts').SettingsPanel;
    parent: FakeElement;
    calls: { binding: Array<[0 | 1, unknown]>; reducedMotion: boolean[]; volume: number[] };
    fireKeydown: (code: string) => void;
    clickKeyButton: (slot: 0 | 1, fieldIndex: number) => void;
  }) => void,
): Promise<void> {
  const dom = installFakeDom();
  try {
    const { SettingsPanel } = await import('../src/ui/settings-panel.ts');
    const parent = new FakeElement('div');
    const calls: { binding: Array<[0 | 1, unknown]>; reducedMotion: boolean[]; volume: number[] } = {
      binding: [],
      reducedMotion: [],
      volume: [],
    };
    const panel = new SettingsPanel(
      parent as unknown as HTMLElement,
      { p1: cloneBinding(DEFAULT_P1_BINDING), p2: cloneBinding(DEFAULT_P2_BINDING), reducedMotion: false, volume: 1 },
      {
        onBindingChange: (slot, binding) => calls.binding.push([slot, binding]),
        onReducedMotionChange: (reduced) => calls.reducedMotion.push(reduced),
        onVolumeChange: (volume) => calls.volume.push(volume),
      },
    );
    const fireKeydown = (code: string): void => {
      (globalThis.window as EventTarget).dispatchEvent(Object.assign(new Event('keydown'), { code }));
    };
    // Rows are rendered in BINDING_FIELDS order inside each player's group;
    // find the slot's group by index (0 = P1, 1 = P2) and click the
    // fieldIndex'th key button in it to start a capture, mirroring what a
    // real click on that row's rebind button does.
    const clickKeyButton = (slot: 0 | 1, fieldIndex: number): void => {
      const listEl = (panel as unknown as { listEl: FakeElement }).listEl;
      const group = listEl.children[slot]!;
      const row = group.children[fieldIndex + 1]!; // [0] is the group title
      const button = row.children[1]!; // [0] label, [1] key button
      button.dispatchEvent(new Event('click'));
    };
    fn({ panel, parent, calls, fireKeydown, clickKeyButton });
  } finally {
    dom.restore();
  }
}

test('rebinding to a key already used by another action for the same player swaps it off', async () => {
  await withPanel(({ clickKeyButton, fireKeydown, panel }) => {
    // P1 field index 1 is 'right' (KeyD by default). Rebind it to 'KeyA',
    // which P1's 'left' already holds.
    clickKeyButton(0, 1);
    fireKeydown('KeyA');
    const p1 = panel.current().p1;
    assert.equal(p1.right, 'KeyA', 'the field being captured should take the new key');
    assert.equal(p1.left, '', 'the other field that held that key for the same player should be cleared');
  });
});

test('the same key can be bound for different players without either being cleared', async () => {
  await withPanel(({ clickKeyButton, fireKeydown, panel }) => {
    // P2's 'jump' is 'Slash' by default; P1's 'jump' is 'Space'. Rebind
    // P1's jump to P2's key -- the swap-off rule is scoped per player, so
    // P2's binding must be untouched even though the same physical key
    // now appears in both bindings.
    clickKeyButton(0, 4); // fieldIndex 4 = 'jump' in BINDING_FIELDS order
    fireKeydown('Slash');
    const { p1, p2 } = panel.current();
    assert.equal(p1.jump, 'Slash');
    assert.equal(p2.jump, 'Slash', 'P2 binding must be unaffected by a P1 rebind using the same key');
  });
});

test('Escape during a capture cancels it and leaves both bindings unchanged', async () => {
  await withPanel(({ clickKeyButton, fireKeydown, panel }) => {
    const before = panel.current();
    clickKeyButton(0, 1);
    fireKeydown('Escape');
    const after = panel.current();
    assert.deepEqual(after.p1, before.p1);
    assert.deepEqual(after.p2, before.p2);
  });
});

test('Reset all settings restores reduced motion and volume, not just key bindings', async () => {
  // Regression for the "Reset to defaults" button previously only
  // resetting key bindings while silently leaving the Accessibility
  // and Audio groups untouched -- see settings-panel.ts resetToDefaults.
  await withPanel(({ clickKeyButton, fireKeydown, panel, calls }) => {
    // Rebind something so we can confirm bindings also still get reset.
    clickKeyButton(0, 1);
    fireKeydown('KeyZ');
    assert.equal(panel.current().p1.right, 'KeyZ');

    // Flip reduced-motion and volume away from their defaults directly
    // on the fake checkbox/slider elements, mirroring what a user
    // interacting with the panel would do, then dispatch the events
    // SettingsPanel listens for.
    const root = panel.root as unknown as FakeElement;
    const reducedMotionCheckbox = root.querySelector('.settings-reduced-motion-checkbox')!;
    reducedMotionCheckbox.checked = true;
    reducedMotionCheckbox.dispatchEvent(new Event('change'));
    const volumeSlider = root.querySelector('.settings-volume-slider')!;
    volumeSlider.value = '40';
    volumeSlider.dispatchEvent(new Event('input'));
    assert.deepEqual(calls.reducedMotion, [true]);
    assert.deepEqual(calls.volume, [0.4]);

    const resetBtn = root.querySelector('.settings-reset-btn')!;
    resetBtn.dispatchEvent(new Event('click'));

    assert.equal(panel.current().p1.right, 'KeyD', 'bindings should be back to default');
    assert.equal(calls.reducedMotion.at(-1), false, 'reset should turn reduced motion back off');
    assert.equal(calls.volume.at(-1), 1, 'reset should restore full volume');
    assert.equal(reducedMotionCheckbox.checked, false, 'checkbox UI should reflect the reset');
    assert.equal(volumeSlider.value, '100', 'slider UI should reflect the reset');
  });
});
