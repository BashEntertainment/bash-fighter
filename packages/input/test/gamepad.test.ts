// Regression tests for issue #12: packages/input/src/gamepad.ts had zero
// test coverage. There's no real Gamepad hardware in this environment, so
// this mocks `navigator.getGamepads` the same way bindings-persistence.test.ts
// mocks localStorage -- a minimal in-memory fake swapped onto globalThis for
// the duration of each test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixed as fx } from '@bash-fighter/sim';
import { BUTTON_ATTACK, BUTTON_JUMP, BUTTON_SHIELD, BUTTON_SPECIAL } from '@bash-fighter/sim';
import { axisToFixed, pollGamepad, listConnectedGamepads } from '../src/gamepad.ts';

interface FakeButton {
  pressed: boolean;
}

interface FakeGamepad {
  connected: boolean;
  axes: number[];
  buttons: FakeButton[];
}

function makeFakeGamepad(overrides: Partial<FakeGamepad> = {}): FakeGamepad {
  return {
    connected: true,
    axes: [0, 0],
    buttons: [
      { pressed: false }, // 0 jump
      { pressed: false }, // 1 attack
      { pressed: false }, // 2 special
      { pressed: false },
      { pressed: false },
      { pressed: false }, // 5 shield
    ],
    ...overrides,
  };
}

function withFakeNavigator<T>(pads: (FakeGamepad | null)[], fn: () => T): T {
  const g = globalThis as unknown as { navigator?: unknown };
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', {
    value: { getGamepads: () => pads },
    configurable: true,
    writable: true,
  });
  try {
    return fn();
  } finally {
    if (previous) {
      Object.defineProperty(globalThis, 'navigator', previous);
    } else {
      delete g.navigator;
    }
  }
}

// --- axisToFixed ---

test('axisToFixed: value inside the deadzone returns fixed-point zero', () => {
  assert.equal(axisToFixed(0.1), 0);
  assert.equal(axisToFixed(-0.1), 0);
  assert.equal(axisToFixed(0), 0);
});

test('axisToFixed: value outside the deadzone converts correctly', () => {
  assert.equal(axisToFixed(0.5), fx.fromFloat(0.5));
  assert.equal(axisToFixed(-0.5), fx.fromFloat(-0.5));
  // right at the deadzone boundary (0.2) is not "inside" (< DEADZONE), so it
  // should pass through unclamped-by-deadzone.
  assert.equal(axisToFixed(0.2), fx.fromFloat(0.2));
});

test('axisToFixed: values at/just past +1/-1 are clamped', () => {
  assert.equal(axisToFixed(1), fx.fromFloat(1));
  assert.equal(axisToFixed(-1), fx.fromFloat(-1));
  assert.equal(axisToFixed(1.5), fx.fromFloat(1));
  assert.equal(axisToFixed(-1.5), fx.fromFloat(-1));
  assert.equal(axisToFixed(2.7), fx.fromFloat(1));
});

// --- pollGamepad ---

test('pollGamepad returns null when the pad slot is missing or disconnected', () => {
  withFakeNavigator([null], () => {
    assert.equal(pollGamepad(0), null);
  });
  withFakeNavigator([makeFakeGamepad({ connected: false })], () => {
    assert.equal(pollGamepad(0), null);
  });
});

test('pollGamepad builds the correct button bitmask', () => {
  const pad = makeFakeGamepad({
    buttons: [
      { pressed: true }, // jump
      { pressed: false },
      { pressed: true }, // special
      { pressed: false },
      { pressed: false },
      { pressed: true }, // shield
    ],
  });
  withFakeNavigator([pad], () => {
    const frame = pollGamepad(0);
    assert.ok(frame);
    assert.equal((frame.buttons & BUTTON_JUMP) !== 0, true);
    assert.equal((frame.buttons & BUTTON_ATTACK) !== 0, false);
    assert.equal((frame.buttons & BUTTON_SPECIAL) !== 0, true);
    assert.equal((frame.buttons & BUTTON_SHIELD) !== 0, true); // shield pressed
  });
});

test('pollGamepad applies stick deadzone/clamp via axisToFixed for X', () => {
  const pad = makeFakeGamepad({ axes: [0.1, 0] });
  withFakeNavigator([pad], () => {
    const frame = pollGamepad(0);
    assert.ok(frame);
    assert.equal(frame.stickX, 0);
  });
});

test('pollGamepad inverts the Y axis so up is positive', () => {
  // Gamepad API convention: axes[1] is negative when the stick is pushed up.
  const pad = makeFakeGamepad({ axes: [0, -0.6] });
  withFakeNavigator([pad], () => {
    const frame = pollGamepad(0);
    assert.ok(frame);
    assert.equal(frame.stickY, fx.fromFloat(0.6));
  });
});

test('pollGamepad reads the correct pad index', () => {
  const padA = makeFakeGamepad({ axes: [0.9, 0] });
  const padB = makeFakeGamepad({ axes: [-0.9, 0] });
  withFakeNavigator([padA, padB], () => {
    const frameA = pollGamepad(0);
    const frameB = pollGamepad(1);
    assert.ok(frameA && frameB);
    assert.equal(frameA.stickX, fx.fromFloat(0.9));
    assert.equal(frameB.stickX, fx.fromFloat(-0.9));
  });
});

// --- listConnectedGamepads ---

test('listConnectedGamepads returns indices of connected pads only', () => {
  withFakeNavigator(
    [makeFakeGamepad(), null, makeFakeGamepad({ connected: false }), makeFakeGamepad()],
    () => {
      assert.deepEqual(listConnectedGamepads(), [0, 3]);
    },
  );
});

test('listConnectedGamepads returns an empty array with no navigator', () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', {
    value: undefined,
    configurable: true,
    writable: true,
  });
  try {
    assert.deepEqual(listConnectedGamepads(), []);
  } finally {
    if (previous) {
      Object.defineProperty(globalThis, 'navigator', previous);
    }
  }
});
