import { describe, expect, it } from 'vitest';
import {
  accessibilityCSS,
  accessibilityZoom,
  DEFAULT_ACCESSIBILITY,
  normalizeAccessibility,
} from './accessibility.js';

describe('accessibility preference migration', () => {
  it('keeps old installations at their original size and appearance', () => {
    for (const old of [undefined, null, false, {}, { unrelated: true }]) {
      const prefs = normalizeAccessibility(old);
      expect(prefs).toEqual(DEFAULT_ACCESSIBILITY);
      expect(accessibilityZoom(prefs)).toBe(1);
      expect(accessibilityCSS(prefs).trim()).toBe('');
    }
  });
  it('rejects malformed stored values instead of accepting truthy strings or unsafe scales', () => {
    expect(
      normalizeAccessibility({
        textSize: 100,
        motion: 'always',
        contrast: 'false',
        readingFont: 1,
        underlineLinks: [],
        textSpacing: {},
      }),
    ).toEqual(DEFAULT_ACCESSIBILITY);
    expect(accessibilityZoom(normalizeAccessibility({ textSize: 'largest' }))).toBe(1.3);
  });
});
