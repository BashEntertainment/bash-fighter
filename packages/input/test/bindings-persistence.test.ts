// Regression tests for the key-remapping persistence added for issue #9
// (packages/input/src/bindings.ts). There's no localStorage in Node, so
// this builds a minimal in-memory fake -- enough to exercise get/set/
// remove and JSON round-tripping, which is all bindings.ts touches.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  loadPersistedBindings,
  savePersistedBindings,
  clearPersistedBindings,
  DEFAULT_P1_BINDING,
  DEFAULT_P2_BINDING,
} from '../src/bindings.ts';

class FakeStorage {
  private map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.has(key) ? this.map.get(key)! : null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
}

function withFakeStorage<T>(fn: () => T): T {
  const g = globalThis as unknown as { localStorage?: unknown };
  const previous = g.localStorage;
  g.localStorage = new FakeStorage();
  try {
    return fn();
  } finally {
    g.localStorage = previous;
  }
}

test('loadPersistedBindings returns null when nothing saved', () => {
  withFakeStorage(() => {
    assert.equal(loadPersistedBindings(), null);
  });
});

test('save then load round-trips a custom binding exactly', () => {
  withFakeStorage(() => {
    const p1 = { ...DEFAULT_P1_BINDING, jump: 'KeyQ', attack: 'KeyE' };
    const p2 = { ...DEFAULT_P2_BINDING, shield: 'Numpad0' };
    savePersistedBindings(p1, p2);
    const loaded = loadPersistedBindings();
    assert.ok(loaded);
    assert.deepEqual(loaded.p1, p1);
    assert.deepEqual(loaded.p2, p2);
  });
});

test('clearPersistedBindings removes a saved override', () => {
  withFakeStorage(() => {
    savePersistedBindings(DEFAULT_P1_BINDING, DEFAULT_P2_BINDING);
    assert.ok(loadPersistedBindings());
    clearPersistedBindings();
    assert.equal(loadPersistedBindings(), null);
  });
});

test('malformed stored JSON is treated as no override, not a crash', () => {
  withFakeStorage(() => {
    localStorage.setItem('bash-fighter:key-bindings', '{"p1": {"jump": 123}}');
    assert.equal(loadPersistedBindings(), null);
  });
});
