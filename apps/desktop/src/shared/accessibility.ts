export interface AccessibilityPreferences {
  textSize: 'default' | 'larger' | 'largest';
  motion: 'system' | 'reduce';
  contrast: boolean;
  underlineLinks: boolean;
  textSpacing: boolean;
  readingFont: boolean;
}

export const DEFAULT_ACCESSIBILITY: AccessibilityPreferences = {
  textSize: 'default',
  motion: 'system',
  contrast: false,
  underlineLinks: false,
  textSpacing: false,
  readingFont: false,
};

export function normalizeAccessibility(value: unknown): AccessibilityPreferences {
  const p = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  return {
    textSize: p.textSize === 'larger' || p.textSize === 'largest' ? p.textSize : 'default',
    motion: p.motion === 'reduce' ? 'reduce' : 'system',
    contrast: p.contrast === true,
    underlineLinks: p.underlineLinks === true,
    textSpacing: p.textSpacing === true,
    readingFont: p.readingFont === true,
  };
}

export function accessibilityZoom(p: AccessibilityPreferences): number {
  return p.textSize === 'largest' ? 1.3 : p.textSize === 'larger' ? 1.15 : 1;
}

/** User-selected reading overrides, applied to the app and each source page.
 * No script, remote service or third-party widget receives browsing data. */
export function accessibilityCSS(p: AccessibilityPreferences): string {
  const c = 'html[data-bb-contrast]';
  const spacing = 'html[data-bb-text-spacing]';
  const motion = 'html[data-bb-reduce-motion]';
  return [
    p.contrast
      ? `${c}, ${c} body, ${c} body *:not(svg):not(svg *):not(img):not(video):not(canvas):not(#__bb_browsing_cloud__):not(#__bb_agent_cursor__) {
      color: #000 !important; background-color: #fff !important; border-color: #000 !important;
      text-shadow: none !important; box-shadow: none !important; background-image: none !important;
    } ${c} body a { color: #003477 !important; } ${c} [role="dialog"] { border: 2px solid #000 !important; }
    ${c} :focus-visible { outline: 3px solid #003477 !important; outline-offset: 3px !important; }`
      : '',
    p.underlineLinks
      ? 'html[data-bb-underline-links] :is(a, [role="link"]) { text-decoration: underline !important; text-underline-offset: .2em !important; }'
      : '',
    p.textSpacing
      ? `${spacing} :is(p, li, label, h1, h2, h3, h4, blockquote, textarea) {
      letter-spacing: .04em !important; word-spacing: .12em !important; line-height: 1.7 !important;
    } ${spacing} :lang(ar) { letter-spacing: normal !important; }`
      : '',
    p.readingFont
      ? 'html[data-bb-reading-font] body, html[data-bb-reading-font] body *:not(svg):not(svg *):not(code):not(pre):not(pre *) { font-family: Arial, Helvetica, sans-serif !important; }'
      : '',
    p.motion === 'reduce'
      ? `${motion}, ${motion} *, ${motion} *::before, ${motion} *::after { animation: none !important; transition: none !important; scroll-behavior: auto !important; }`
      : '',
  ].join('\n');
}

// The selectors are dormant unless their matching preference is enabled. This
// also makes Reset reliable while documents navigate or old CSS keys expire.
export const ACCESSIBILITY_STYLES = accessibilityCSS({
  ...DEFAULT_ACCESSIBILITY,
  motion: 'reduce',
  contrast: true,
  underlineLinks: true,
  textSpacing: true,
  readingFont: true,
});
