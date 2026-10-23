import { describe, expect, it } from 'vitest';
import {
  COMPACT_BELOW,
  CONTENT_MAX_WIDTH,
  DEFAULT_SLOT_WIDTH,
  GUTTER,
  GUTTER_CLASS,
  RAIL_WIDTH,
  WIDE_FROM,
  layoutFor,
} from './layout.js';

describe('layoutFor', () => {
  it('uses the compact layout at the narrowest the page slot can be', () => {
    expect(layoutFor(520)).toEqual({
      size: 'compact',
      slotWidth: 520,
      contentWidth: 488,
      columns: 1,
    });
  });

  it('switches from the row to the rail at the breakpoint', () => {
    expect(layoutFor(COMPACT_BELOW - 1).size).toBe('compact');
    expect(layoutFor(COMPACT_BELOW).size).toBe('regular');
    expect(layoutFor(WIDE_FROM - 1).size).toBe('regular');
    expect(layoutFor(WIDE_FROM).size).toBe('wide');
  });

  it('gives the default window a rail and one column of content', () => {
    // 840 is the slot at the default window size with the assistant panel open.
    expect(layoutFor(840)).toEqual({
      size: 'regular',
      slotWidth: 840,
      contentWidth: 840 - RAIL_WIDTH.regular - 2 * GUTTER.regular,
      columns: 1,
    });
  });

  it('offers more columns as the slot grows, up to three', () => {
    expect(layoutFor(700).columns).toBe(2);
    // With the rail: two columns once the content has 640px, three once it has 1040px.
    const twoFrom = 640 + RAIL_WIDTH.regular + 2 * GUTTER.regular;
    expect(layoutFor(twoFrom - 1).columns).toBe(1);
    expect(layoutFor(twoFrom).columns).toBe(2);
    expect(layoutFor(1280).columns).toBe(2);
    const threeFrom = 1040 + RAIL_WIDTH.wide + 2 * GUTTER.wide;
    expect(layoutFor(threeFrom - 1).columns).toBe(2);
    expect(layoutFor(threeFrom).columns).toBe(3);
    expect(layoutFor(1500).columns).toBe(3);
  });

  it('stops the content growing past its maximum width', () => {
    const veryWide = layoutFor(2400);
    expect(veryWide.contentWidth).toBe(CONTENT_MAX_WIDTH - 2 * GUTTER.wide);
    expect(veryWide.columns).toBe(3);
  });

  it('assumes the default window until the slot has been measured', () => {
    expect(layoutFor(null)).toEqual(layoutFor(DEFAULT_SLOT_WIDTH));
    expect(layoutFor(undefined)).toEqual(layoutFor(DEFAULT_SLOT_WIDTH));
    // A hidden workspace measures zero; that is not a real width.
    expect(layoutFor(0)).toEqual(layoutFor(DEFAULT_SLOT_WIDTH));
  });

  it('never reports a negative width', () => {
    expect(layoutFor(10).contentWidth).toBe(0);
  });

  it('keeps the gutter classes in step with the gutter widths', () => {
    // Tailwind's px-N is N * 4 pixels on each side.
    for (const size of ['compact', 'regular', 'wide'] as const) {
      const step = Number(/^px-(\d+)$/.exec(GUTTER_CLASS[size])?.[1]);
      expect(step * 4).toBe(GUTTER[size]);
    }
  });
});
