// Checks the contrast the workspace's design language promises: at least 4.5:1
// for text and 3:1 for the edge of anything that can be operated. The colours
// are read from the class strings in styles.ts and from the app's Tailwind
// theme, composited the way the browser composites them, and measured with the
// WCAG formula. Lowering an opacity step or changing a brand colour so that a
// pair drops below its minimum fails here.

import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import {
  FOCUS_RING,
  alert,
  badge,
  button,
  card,
  control,
  floating,
  ink,
  line,
  menu,
  nav,
  surface,
  tabs,
  text,
} from './styles.js';

type Rgb = [number, number, number];
interface Paint {
  rgb: Rgb;
  alpha: number;
}

const require = createRequire(import.meta.url);
const theme = (
  require('../../../../tailwind.config.cjs') as {
    theme: { extend: { colors: Record<string, Record<string, string>> } };
  }
).theme.extend.colors;

/** The stock Tailwind colours the workspace uses besides the app's own tokens. */
const STOCK: Record<string, string> = {
  white: '#ffffff',
  black: '#000000',
  'red-300': '#fca5a5',
  'red-400': '#f87171',
  'emerald-300': '#6ee7b7',
  'emerald-400': '#34d399',
};

function hex(value: string): Rgb {
  const digits = value.replace('#', '');
  return [0, 2, 4].map((at) => parseInt(digits.slice(at, at + 2), 16)) as Rgb;
}

function colour(name: string): Rgb {
  if (STOCK[name]) return hex(STOCK[name]);
  const [family, ...rest] = name.split('-');
  const shade = rest.join('-') || 'DEFAULT';
  const value = family ? theme[family]?.[shade] : undefined;
  if (!value) throw new Error(`No colour for "${name}"`);
  return hex(value);
}

/** Reads one colour utility, such as "text-ink-inverse/70" or "hover:bg-white/[0.07]". */
function paint(utility: string): Paint {
  const base = utility.split(':').pop() ?? '';
  const match = /^(?:text|bg|border|decoration)-(.+?)(?:\/(?:\[([\d.]+)\]|(\d+)))?$/.exec(base);
  if (!match?.[1]) throw new Error(`Not a colour utility: "${utility}"`);
  const alpha = match[2] ? Number(match[2]) : match[3] ? Number(match[3]) / 100 : 1;
  return { rgb: colour(match[1]), alpha };
}

/** The colour utility in a class string for a property and (optionally) a variant such as "hover". */
function find(classes: string, property: 'text' | 'bg' | 'border', variant = ''): string {
  const prefix = variant ? `${variant}:` : '';
  const found = classes.split(/\s+/).find((candidate) => {
    if (!candidate.startsWith(`${prefix}${property}-`)) return false;
    try {
      paint(candidate);
      return true;
    } catch {
      return false; // a size or weight utility such as text-sm
    }
  });
  if (!found) throw new Error(`No ${prefix}${property}-* colour in "${classes}"`);
  return found;
}

/** A utility without its variants: "focus:border-primary" is "border-primary". */
function bare(utility: string): string {
  return utility.split(':').pop() ?? utility;
}

function over(top: Paint, below: Rgb): Rgb {
  return top.rgb.map(
    (channel, index) => channel * top.alpha + (below[index] ?? 0) * (1 - top.alpha),
  ) as Rgb;
}

/** Layers painted bottom to top, as one opaque colour. */
function stack(...layers: string[]): Rgb {
  return layers.reduce<Rgb>((below, layer) => over(paint(layer), below), [0, 0, 0]);
}

function luminance(rgb: Rgb): number {
  const [r, g, b] = rgb.map((value) => {
    const channel = value / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  }) as Rgb;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function ratio(a: Rgb, b: Rgb): number {
  const [lighter, darker] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (lighter + 0.05) / (darker + 0.05);
}

/** The contrast of a (possibly translucent) colour utility painted on an opaque background. */
function contrastOn(utility: string, background: Rgb): number {
  return ratio(over(paint(utility), background), background);
}

const TEXT_MINIMUM = 4.5;
const EDGE_MINIMUM = 3;

// What things sit on. A card sits on the page; a field or a raised row can sit
// on the page or on a card; a menu or dialog is the raised tint over the navy.
const PAGE = stack(surface.page);
const CARD = stack(surface.page, surface.card);
const RAISED = stack(surface.page, surface.raised);
const FLOATING = stack(find(floating.outer, 'bg'), find(floating.inner, 'bg'));
const HOVERED_CARD = stack(surface.page, find(card.interactive, 'bg', 'hover'));
const SURFACES: Record<string, Rgb> = {
  page: PAGE,
  card: CARD,
  raised: RAISED,
  floating: FLOATING,
};
const FIELDS: Record<string, Rgb> = {
  'field on page': stack(surface.page, surface.field),
  'field on card': stack(surface.page, surface.card, surface.field),
  'field in dialog': over(paint(surface.field), FLOATING),
};

describe('text contrast (at least 4.5:1)', () => {
  it('holds for every text colour on every surface', () => {
    const colours = { ...ink } as Record<string, string>;
    delete colours.onAction;
    for (const [name, utility] of Object.entries(colours)) {
      for (const [where, background] of Object.entries({ ...SURFACES, ...FIELDS })) {
        expect(contrastOn(utility, background), `${name} on ${where}`).toBeGreaterThanOrEqual(
          TEXT_MINIMUM,
        );
      }
    }
  });

  it('holds for every type style', () => {
    for (const [name, classes] of Object.entries(text)) {
      for (const [where, background] of Object.entries(SURFACES)) {
        expect(
          contrastOn(find(classes, 'text'), background),
          `${name} on ${where}`,
        ).toBeGreaterThanOrEqual(TEXT_MINIMUM);
      }
    }
  });

  it('holds for the text of every button, at rest and hovered', () => {
    const filled = [
      ['primary', button.variant.primary],
      ['danger', button.variant.danger],
    ] as const;
    for (const [name, classes] of filled) {
      const label = find(classes, 'text');
      expect(contrastOn(label, stack(find(classes, 'bg'))), name).toBeGreaterThanOrEqual(
        TEXT_MINIMUM,
      );
      expect(
        contrastOn(label, stack(find(classes, 'bg', 'enabled:hover'))),
        `${name} hovered`,
      ).toBeGreaterThanOrEqual(TEXT_MINIMUM);
    }
    expect(
      contrastOn(ink.onAction, stack(find(button.variant.primary, 'bg'))),
    ).toBeGreaterThanOrEqual(TEXT_MINIMUM);

    const plain = [
      ['secondary', button.variant.secondary],
      ['quiet', button.variant.quiet],
      ['quiet icon', button.icon.tone.quiet],
      ['outlined icon', button.icon.tone.outlined],
    ] as const;
    for (const [name, classes] of plain) {
      const label = find(classes, 'text');
      const hover = find(classes, 'bg', 'enabled:hover');
      for (const [where, background] of Object.entries(SURFACES)) {
        expect(contrastOn(label, background), `${name} on ${where}`).toBeGreaterThanOrEqual(
          TEXT_MINIMUM,
        );
        expect(
          contrastOn(label, over(paint(hover), background)),
          `${name} hovered on ${where}`,
        ).toBeGreaterThanOrEqual(TEXT_MINIMUM);
      }
    }
  });

  it('holds for badges and alerts on their tinted backgrounds', () => {
    for (const [tone, classes] of Object.entries(badge.tone)) {
      for (const [where, background] of Object.entries(SURFACES)) {
        const tint = over(paint(find(classes, 'bg')), background);
        expect(
          contrastOn(find(classes, 'text'), tint),
          `${tone} badge on ${where}`,
        ).toBeGreaterThanOrEqual(TEXT_MINIMUM);
      }
    }
    for (const [tone, classes] of Object.entries(alert.tone)) {
      for (const [where, background] of Object.entries(SURFACES)) {
        const tint = over(paint(find(classes, 'bg')), background);
        expect(
          contrastOn(find(alert.base, 'text'), tint),
          `${tone} alert on ${where}`,
        ).toBeGreaterThanOrEqual(TEXT_MINIMUM);
        // The icon carries the tone; it is a graphic, so 3:1 is its minimum.
        const icon = alert.icon[tone as keyof typeof alert.icon];
        expect(contrastOn(icon, tint), `${tone} alert icon on ${where}`).toBeGreaterThanOrEqual(
          EDGE_MINIMUM,
        );
      }
    }
  });

  it('holds for fields: what is typed, the placeholder, the label, the hint and the error', () => {
    for (const [where, background] of Object.entries(FIELDS)) {
      expect(
        contrastOn(find(control.field, 'text'), background),
        `typed text, ${where}`,
      ).toBeGreaterThanOrEqual(TEXT_MINIMUM);
      expect(
        contrastOn(find(control.field, 'text', 'placeholder'), background),
        `placeholder, ${where}`,
      ).toBeGreaterThanOrEqual(TEXT_MINIMUM);
    }
    for (const [where, background] of Object.entries(SURFACES)) {
      for (const part of ['label', 'optional', 'hint', 'error'] as const) {
        expect(
          contrastOn(find(control[part], 'text'), background),
          `${part} on ${where}`,
        ).toBeGreaterThanOrEqual(TEXT_MINIMUM);
      }
    }
  });

  it('holds for the navigation, tabs and menus', () => {
    expect(contrastOn(find(nav.idle, 'text'), PAGE)).toBeGreaterThanOrEqual(TEXT_MINIMUM);
    expect(
      contrastOn(
        find(nav.idle, 'text', 'hover'),
        stack(surface.page, find(nav.idle, 'bg', 'hover')),
      ),
    ).toBeGreaterThanOrEqual(TEXT_MINIMUM);
    expect(
      contrastOn(find(nav.current, 'text'), stack(surface.page, find(nav.current, 'bg'))),
    ).toBeGreaterThanOrEqual(TEXT_MINIMUM);
    expect(contrastOn(find(nav.pillIdle, 'text'), PAGE)).toBeGreaterThanOrEqual(TEXT_MINIMUM);
    expect(contrastOn(find(nav.pillCurrent, 'text'), PAGE)).toBeGreaterThanOrEqual(TEXT_MINIMUM);

    for (const [where, background] of Object.entries(SURFACES)) {
      expect(
        contrastOn(find(tabs.idle, 'text'), background),
        `tab on ${where}`,
      ).toBeGreaterThanOrEqual(TEXT_MINIMUM);
      expect(
        contrastOn(find(tabs.selected, 'text'), background),
        `current tab on ${where}`,
      ).toBeGreaterThanOrEqual(TEXT_MINIMUM);
    }

    const hoveredItem = over(paint(find(menu.item, 'bg', 'hover')), FLOATING);
    for (const background of [FLOATING, hoveredItem]) {
      expect(contrastOn(find(menu.item, 'text'), background)).toBeGreaterThanOrEqual(TEXT_MINIMUM);
      expect(contrastOn(find(menu.danger, 'text'), background)).toBeGreaterThanOrEqual(
        TEXT_MINIMUM,
      );
    }
    expect(contrastOn(find(menu.groupLabel, 'text'), FLOATING)).toBeGreaterThanOrEqual(
      TEXT_MINIMUM,
    );
  });
});

describe('edges of controls (at least 3:1)', () => {
  it('holds for the control line against every surface it can sit on', () => {
    for (const [where, background] of Object.entries({
      ...SURFACES,
      ...FIELDS,
      'hovered card': HOVERED_CARD,
    })) {
      expect(
        contrastOn(line.control, background),
        `control line on ${where}`,
      ).toBeGreaterThanOrEqual(EDGE_MINIMUM);
    }
  });

  it('holds for fields, choices and outlined buttons, which all use the control line', () => {
    const edges = [
      control.idle,
      control.choice,
      control.option,
      button.variant.secondary,
      button.icon.tone.outlined,
      card.interactive,
    ];
    for (const classes of edges) expect(find(classes, 'border')).toBe(line.control);
  });

  it('holds for the invalid, selected and focused states', () => {
    for (const [where, background] of Object.entries({ ...SURFACES, ...FIELDS })) {
      expect(
        contrastOn(find(control.invalid, 'border'), background),
        `invalid on ${where}`,
      ).toBeGreaterThanOrEqual(EDGE_MINIMUM);
      expect(contrastOn(line.active, background), `selected on ${where}`).toBeGreaterThanOrEqual(
        EDGE_MINIMUM,
      );
      expect(ratio(hex(FOCUS_RING), background), `focus ring on ${where}`).toBeGreaterThanOrEqual(
        EDGE_MINIMUM,
      );
    }
    expect(bare(find(control.field, 'border', 'focus'))).toBe(line.active);
    expect(bare(find(control.choice, 'border', 'checked'))).toBe(line.active);
    expect(FOCUS_RING.toLowerCase()).toBe(theme.primary?.DEFAULT?.toLowerCase());
  });

  it('holds for filled buttons against what they sit on', () => {
    for (const classes of [button.variant.primary, button.variant.danger]) {
      for (const [where, background] of Object.entries(SURFACES)) {
        expect(
          ratio(stack(find(classes, 'bg')), background),
          `fill on ${where}`,
        ).toBeGreaterThanOrEqual(EDGE_MINIMUM);
      }
    }
  });

  it('holds for a ticked choice: the box against its surround, the mark against the box', () => {
    const box = stack(find(control.choice, 'bg', 'checked'));
    for (const [where, background] of Object.entries(SURFACES)) {
      expect(ratio(box, background), `ticked box on ${where}`).toBeGreaterThanOrEqual(EDGE_MINIMUM);
    }
    expect(contrastOn(ink.onAction, box)).toBeGreaterThanOrEqual(EDGE_MINIMUM);
  });

  it('keeps hairlines decorative: nothing operable relies on one', () => {
    // A hairline is far below 3:1 by design. It may only show structure.
    expect(contrastOn(line.hairline, PAGE)).toBeLessThan(EDGE_MINIMUM);
    expect(find(card.base, 'border')).toBe(line.hairline);
    expect(find(card.interactive, 'border')).not.toBe(line.hairline);
  });
});

describe('the surfaces', () => {
  it('step up from the page: card, then raised', () => {
    expect(luminance(CARD)).toBeGreaterThan(luminance(PAGE));
    expect(luminance(RAISED)).toBeGreaterThan(luminance(CARD));
    expect(luminance(FLOATING)).toBeGreaterThan(luminance(CARD));
  });

  it('are the brand navy underneath', () => {
    expect(PAGE).toEqual(hex(theme.surface?.dark ?? ''));
    expect(PAGE).toEqual([7, 20, 34]);
  });
});
