import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: '#20BAD1',
          hover: '#1FA6BB',
        },
        accent: {
          DEFAULT: '#20BAD1',
          hover: '#1FA6BB',
        },
        surface: {
          dark: '#142127',
          light: '#FFFFFF',
          muted: '#F9FAFB',
        },
        ink: {
          primary: '#142127',
          secondary: '#6B7280',
          inverse: '#FFFFFF',
        },
        line: {
          DEFAULT: '#E5E7EB',
          strong: '#CBD5E1',
        },
        // BulleBrowser's own palette (packages/brand-tokens), for illustrations
        // of the app itself.
        brand: {
          teal: '#20BAD1',
          gold: '#E8D833',
          navy: '#071422',
          ice: '#EFF7F8',
        },
      },
      fontFamily: {
        ui: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['var(--font-jetbrains)', 'ui-monospace', 'Menlo', 'monospace'],
      },
    },
  },
  plugins: [],
};

export default config;
