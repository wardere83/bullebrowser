export const product = {
  name: 'BulleBrowser',
  vendor: 'Bulle Consulting',
  // "CBOs" is always the acronym, here and wherever these two lines are shown.
  tagline: 'The strategic funding platform for businesses and CBOs',
  description:
    'BulleBrowser is a strategic funding platform that helps businesses and CBOs discover funding opportunities, understand funder priorities, assess alignment, and navigate proposal development ethically.',
  domain: 'bullebrowser.com',
  bundleId: 'com.bulleconsulting.bullebrowser',
  // Must match electron-builder.yml's `appId` exactly (case-sensitive) so the
  // runtime AppUserModelID lines up with the installer's — otherwise Windows
  // treats the running app as a second, ungrouped taskbar entry.
  appId: 'com.bulleconsulting.bullebrowser',
  windowTitle: 'BulleBrowser',
  splashText: 'BulleBrowser',
  contactEmail: 'hello@bulleconsulting.com',
} as const;

// BulleBrowser brand palette. These seven are the brand's own values; the
// remaining tokens (hover states, borders) are derived from them so nothing in
// the UI has to invent a colour.
export const colors = {
  primary: '#20BAD1', // Teal
  primaryHover: '#1A9BAE', // Teal, darkened for hover/active
  accent: '#E8D833', // Yellow Gold
  accentHover: '#CBBC26', // Gold, darkened for hover/active
  surfaceDark: '#071422', // Deep Navy
  surfaceLight: '#FFFFFF', // White
  surfaceMuted: '#EFF7F8', // Ice Blue
  textPrimary: '#191825', // Near Black — headings
  textSecondary: '#818891', // Slate Gray — body text
  textInverse: '#FFFFFF', // White
  border: '#DCE9EC', // Ice Blue, stepped down for hairlines
  borderStrong: '#BFD4D9',
  success: '#10B981',
  danger: '#EF4444',
  warning: '#E8D833', // the brand gold doubles as the warning tone
} as const;

export const typography = {
  uiFont: '"DM Sans", system-ui, -apple-system, "Segoe UI", sans-serif',
  monoFont: '"JetBrains Mono", ui-monospace, "SF Mono", Menlo, monospace',
  scale: {
    xs: '0.75rem',
    sm: '0.875rem',
    base: '1rem',
    lg: '1.125rem',
    xl: '1.25rem',
    '2xl': '1.5rem',
    '3xl': '1.875rem',
    '4xl': '2.25rem',
    '5xl': '3rem',
  },
} as const;

export const radii = {
  sm: '4px',
  md: '8px',
  lg: '12px',
  xl: '16px',
  pill: '9999px',
} as const;

export const spacing = {
  topBarHeight: 44,
  tabStripHeight: 36,
  aiPanelWidth: 440,
  sidePadding: 12,
} as const;

export type ColorToken = keyof typeof colors;
export type ProductInfo = typeof product;
