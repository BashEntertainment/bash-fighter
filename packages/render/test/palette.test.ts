// Regression test for issue #13: PALETTE.playerColors (packages/render/src/palette.ts)
// asserts several properties in its own comments that no test actually checked --
// 20 distinct entries, no two adjacent slots reading as the same hue, and every
// entry pushed clear of PALETTE.danger and PALETTE.hazardWarning. There's no
// colour library in this repo (npm registry access is limited for agents here),
// so this writes a tiny inline hex-to-HSL helper.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PALETTE } from '../src/palette.ts';

/** Converts a 0xRRGGBB colour to [hue, saturation, lightness]; hue in degrees [0, 360). */
function hexToHsl(hex: number): { h: number; s: number; l: number } {
  const r = ((hex >> 16) & 0xff) / 255;
  const g = ((hex >> 8) & 0xff) / 255;
  const b = (hex & 0xff) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  let h = 0;
  let s = 0;
  if (d !== 0) {
    s = d / (1 - Math.abs(2 * l - 1));
    switch (max) {
      case r:
        h = ((g - b) / d) % 6;
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      default:
        h = (r - g) / d + 4;
        break;
    }
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s, l };
}

/** Smallest angular distance between two hues in degrees, in [0, 180]. */
function hueDelta(a: number, b: number): number {
  const diff = Math.abs(a - b) % 360;
  return diff > 180 ? 360 - diff : diff;
}

const HUE_ADJACENCY_THRESHOLD_DEG = 8;
const RESERVED_HUE_THRESHOLD_DEG = 8;

test('playerColors has exactly 20 entries, all numerically distinct', () => {
  assert.equal(PALETTE.playerColors.length, 20);
  assert.equal(new Set(PALETTE.playerColors).size, 20);
});

test('no two playerColors entries are within 8 degrees of hue of each other', () => {
  const hues = PALETTE.playerColors.map((c) => hexToHsl(c).h);
  const offenders: string[] = [];
  for (let i = 0; i < hues.length; i++) {
    for (let j = i + 1; j < hues.length; j++) {
      const delta = hueDelta(hues[i]!, hues[j]!);
      if (delta < HUE_ADJACENCY_THRESHOLD_DEG) {
        offenders.push(`slots ${i} and ${j}: hue delta ${delta.toFixed(1)} deg`);
      }
    }
  }
  assert.deepEqual(offenders, []);
});

test('no playerColors entry is within 8 degrees of PALETTE.danger', () => {
  const dangerHue = hexToHsl(PALETTE.danger).h;
  const offenders: string[] = [];
  PALETTE.playerColors.forEach((c, i) => {
    const delta = hueDelta(hexToHsl(c).h, dangerHue);
    if (delta < RESERVED_HUE_THRESHOLD_DEG) {
      offenders.push(`slot ${i}: hue delta ${delta.toFixed(1)} deg from danger`);
    }
  });
  assert.deepEqual(offenders, []);
});

test('no playerColors entry is within 8 degrees of PALETTE.hazardWarning', () => {
  const hazardHue = hexToHsl(PALETTE.hazardWarning).h;
  const offenders: string[] = [];
  PALETTE.playerColors.forEach((c, i) => {
    const delta = hueDelta(hexToHsl(c).h, hazardHue);
    if (delta < RESERVED_HUE_THRESHOLD_DEG) {
      offenders.push(`slot ${i}: hue delta ${delta.toFixed(1)} deg from hazardWarning`);
    }
  });
  assert.deepEqual(offenders, []);
});
