// Filled buttons in the browser chrome (top bar, dialogs, the page error) must
// keep their labels legible: 4.5:1 or more. White on the teal measured 2.3:1
// and white on the gold 1.5:1. Inside the chat panel, styles.css repaints white
// labels on teal in navy, so only components drawn outside it are checked here.

import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const colors = (require('../../../tailwind.config.cjs') as {
  theme: { extend: { colors: Record<string, Record<string, string>> } };
}).theme.extend.colors;

function hex(name: string): string | undefined {
  if (name === 'white') return '#ffffff';
  const [family, ...rest] = name.split('-');
  return family ? colors[family]?.[rest.join('-') || 'DEFAULT'] : undefined;
}

function luminance(value: string): number {
  const [r, g, b] = [1, 3, 5].map((at) => {
    const c = parseInt(value.slice(at, at + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function ratio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

const OUTSIDE_CHAT_PANEL = [
  'BrowserPane.tsx',
  'ConfirmDialog.tsx',
  'PasswordControls.tsx',
  'SearchKeySettings.tsx',
  'SettingsModal.tsx',
  'UpdateBanner.tsx',
];

describe('filled buttons in the browser chrome', () => {
  it.each(OUTSIDE_CHAT_PANEL)('%s labels its filled buttons legibly', (file) => {
    const source = readFileSync(new URL(`./${file}`, import.meta.url), 'utf8');
    const filled = [...source.matchAll(/className="([^"]*)"/g)]
      .map((match) => match[1]!.split(/\s+/))
      .filter((classes) => classes.some((c) => /^bg-(primary|accent)$/.test(c)));
    expect(filled.length).toBeGreaterThan(0);
    for (const classes of filled) {
      const background = hex(classes.find((c) => /^bg-(primary|accent)$/.test(c))!.slice(3))!;
      const text = classes.map((c) => /^text-([a-z]+(?:-[a-z]+)?)$/.exec(c)?.[1]).map((n) => n && hex(n)).find(Boolean);
      expect(text, classes.join(' ')).toBeDefined();
      expect(ratio(text!, background), classes.join(' ')).toBeGreaterThanOrEqual(4.5);
    }
  });
});
