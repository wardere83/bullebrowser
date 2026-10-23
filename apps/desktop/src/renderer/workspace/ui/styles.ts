// The workspace's design language, in one place.
//
// Every class string a screen needs for colour, type, spacing and structure is
// here, so screens compose these instead of inventing their own. The colours
// are the app's existing Tailwind tokens (the brand navy, teal and gold, white
// at stepped opacities) plus two stock Tailwind hues for states the brand
// palette has no token for: emerald for success and red for errors.
//
// The rules the values encode:
//  - Page is the brand navy. A card is one shade lighter. Nothing is lighter
//    than `raised` except the fill of a primary or danger button.
//  - Text is white at four steps. `subtle` is the faintest text allowed.
//  - Two kinds of line. A hairline (`line.hairline`) shows structure and is
//    decorative. A control line (`line.control`) is the edge of something you
//    can operate, and keeps 3:1 against every surface.
//  - Teal is for the primary action, links, focus and the current item. Gold is
//    for cautions only.
//
// contrast.test.ts computes the contrast of every pair these strings promise,
// so a change here that drops below 4.5:1 for text or 3:1 for a control edge
// fails the tests.

/** Joins class names, skipping anything falsy. */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

// ─────────────────────────────────── colour ───────────────────────────────────

export const surface = {
  /** The workspace page: the brand navy. */
  page: 'bg-surface-dark',
  /** A card, one shade lighter than the page. */
  card: 'bg-white/[0.04]',
  /** A selected row, a hovered card, the inside of a menu or dialog. */
  raised: 'bg-white/[0.07]',
  /** The fill of a text field. */
  field: 'bg-white/[0.06]',
  /** What dims the app behind a dialog. */
  scrim: 'bg-black/60',
} as const;

export const ink = {
  /** Headings and the text of controls. */
  strong: 'text-ink-inverse',
  /** Body text. */
  body: 'text-ink-inverse/85',
  /** Descriptions and secondary text. */
  muted: 'text-ink-inverse/70',
  /** Captions and metadata. The faintest text allowed. */
  subtle: 'text-ink-inverse/60',
  /** Links and quiet actions. */
  link: 'text-primary',
  success: 'text-emerald-300',
  /** Cautions only. */
  caution: 'text-accent',
  danger: 'text-red-300',
  /** Text on a filled primary or danger button. */
  onAction: 'text-surface-dark',
} as const;

export const line = {
  /** Structure: the edge of a card, a divider. Decorative. */
  hairline: 'border-white/10',
  /** The edge of anything that can be operated: fields, outlined buttons, choices. */
  control: 'border-white/40',
  /** The current or selected item. */
  active: 'border-primary',
  danger: 'border-red-400',
} as const;

/** The colour of the focus ring; the rule itself is `.workspace :focus-visible` in styles.css. */
export const FOCUS_RING = '#20BAD1';

// ──────────────────────────────────── type ────────────────────────────────────

export const text = {
  /** One per screen. */
  h1: 'text-[22px] font-semibold leading-7 tracking-tight text-ink-inverse',
  /** A section of a screen, and the title of a card or dialog. */
  h2: 'text-base font-semibold leading-6 text-ink-inverse',
  /** A group inside a section. */
  h3: 'text-sm font-semibold leading-5 text-ink-inverse',
  /** The sentence under an h1. */
  lead: 'text-[15px] leading-6 text-ink-inverse/70',
  body: 'text-sm leading-6 text-ink-inverse/85',
  small: 'text-[13px] leading-5 text-ink-inverse/70',
  caption: 'text-xs leading-4 text-ink-inverse/60',
  /** A short uppercase label above a group, as the app's chrome uses in Settings. */
  overline: 'text-[11px] font-semibold uppercase leading-4 tracking-[0.08em] text-ink-inverse/60',
  /** A text link inside a sentence. */
  link: 'text-primary underline decoration-primary/50 underline-offset-2 hover:decoration-primary',
} as const;

// ─────────────────────────────────── layout ───────────────────────────────────

export const layout = {
  /** The root of a screen: its h1 block, then its sections. */
  screen: 'flex flex-col gap-8',
  /** A section: its heading, then its content. */
  section: 'flex flex-col gap-4',
  /** Things that belong together, stacked. */
  stack: 'flex flex-col gap-3',
  /** Things that belong together, side by side, wrapping when there is no room. */
  row: 'flex flex-wrap items-center gap-2',
  /** Cards that share a row when the screen is wide enough and stack when it is not. */
  cardGrid: 'grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(min(100%,17.5rem),1fr))]',
  /** Two blocks side by side when each has room for about 18rem, stacked otherwise. */
  split:
    'grid gap-x-8 gap-y-5 [grid-template-columns:repeat(auto-fit,minmax(min(100%,18rem),1fr))]',
  /** Keeps a paragraph to a readable line length. */
  prose: 'max-w-[68ch]',
  divider: 'border-t border-white/10',
  /** A list whose rows are separated by hairlines. */
  list: 'divide-y divide-white/10',
} as const;

// ────────────────────────────────── components ─────────────────────────────────

export const card = {
  base: 'rounded-xl border border-white/10 bg-white/[0.04]',
  /** A card that is itself a button. */
  interactive:
    'rounded-xl border border-white/40 bg-white/[0.04] text-left transition-colors hover:border-white/60 hover:bg-white/[0.07]',
  padding: { none: '', sm: 'p-3', md: 'p-4', lg: 'p-5' },
} as const;

export const button = {
  base: 'relative inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-lg font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 aria-disabled:cursor-progress',
  size: {
    sm: 'h-8 px-3 text-[13px]',
    md: 'h-9 px-4 text-sm',
    lg: 'h-11 px-5 text-sm',
  },
  variant: {
    primary: 'bg-primary text-surface-dark enabled:hover:bg-primary-hover',
    secondary: 'border border-white/40 text-ink-inverse enabled:hover:bg-white/10',
    quiet: 'text-primary enabled:hover:bg-white/10',
    danger: 'bg-red-400 text-surface-dark enabled:hover:bg-red-300',
  },
  icon: {
    base: 'inline-flex shrink-0 items-center justify-center rounded-lg transition-colors disabled:cursor-not-allowed disabled:opacity-50',
    size: { sm: 'h-7 w-7', md: 'h-9 w-9' },
    tone: {
      quiet: 'text-ink-inverse/70 enabled:hover:bg-white/10 enabled:hover:text-ink-inverse',
      outlined: 'border border-white/40 text-ink-inverse enabled:hover:bg-white/10',
    },
  },
} as const;

export const control = {
  label: 'text-[13px] font-medium leading-5 text-ink-inverse',
  optional: 'font-normal text-ink-inverse/60',
  hint: 'text-xs leading-4 text-ink-inverse/60',
  error: 'flex items-start gap-1.5 text-xs leading-4 text-red-300',
  /** Shared by Input, Select and Textarea. */
  field:
    'w-full rounded-lg border bg-white/[0.06] px-3 text-sm text-ink-inverse placeholder:text-ink-inverse/55 transition-colors focus:border-primary disabled:cursor-not-allowed disabled:opacity-60',
  idle: 'border-white/40 enabled:hover:border-white/60',
  invalid: 'border-red-400',
  input: 'h-9',
  select: 'h-9 appearance-none pr-9',
  textarea: 'min-h-[5.5rem] resize-y py-2 leading-6',
  /** The box of a checkbox or radio button. */
  choice:
    'peer h-4 w-4 shrink-0 appearance-none border border-white/40 bg-white/[0.06] transition-colors checked:border-primary checked:bg-primary disabled:cursor-not-allowed disabled:opacity-60',
  /** A radio option drawn as a selectable card. */
  option:
    'flex cursor-pointer items-start gap-2.5 rounded-lg border border-white/40 bg-white/[0.04] px-3 py-2.5 transition-colors hover:border-white/60 has-[:checked]:border-primary has-[:checked]:bg-primary/[0.12] has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60',
} as const;

export const badge = {
  base: 'inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium leading-4',
  tone: {
    neutral: 'border-white/15 bg-white/[0.08] text-ink-inverse/85',
    info: 'border-primary/30 bg-primary/[0.12] text-primary',
    success: 'border-emerald-400/30 bg-emerald-400/[0.12] text-emerald-300',
    caution: 'border-accent/30 bg-accent/[0.12] text-accent',
    danger: 'border-red-400/30 bg-red-400/[0.12] text-red-300',
  },
} as const;

export const alert = {
  base: 'flex items-start gap-3 rounded-lg border px-3.5 py-3 text-sm leading-6 text-ink-inverse/85',
  tone: {
    info: 'border-primary/30 bg-primary/[0.12]',
    success: 'border-emerald-400/30 bg-emerald-400/[0.12]',
    caution: 'border-accent/30 bg-accent/[0.12]',
    error: 'border-red-400/30 bg-red-400/[0.12]',
  },
  /** The icon carries the tone; the text stays at body strength. */
  icon: {
    info: 'text-primary',
    success: 'text-emerald-300',
    caution: 'text-accent',
    error: 'text-red-300',
  },
} as const;

export const tabs = {
  list: 'flex gap-1 overflow-x-auto border-b border-white/10',
  tab: '-mb-px inline-flex shrink-0 items-center gap-2 whitespace-nowrap border-b-2 px-3 py-2 text-[13px] font-medium transition-colors',
  idle: 'border-transparent text-ink-inverse/70 hover:text-ink-inverse',
  selected: 'border-primary text-ink-inverse',
  disabled: 'cursor-not-allowed border-transparent text-ink-inverse/60 opacity-60',
} as const;

export const nav = {
  item: 'flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-[13px] font-medium leading-5 transition-colors',
  idle: 'text-ink-inverse/70 hover:bg-white/[0.07] hover:text-ink-inverse',
  current: 'bg-white/[0.07] text-ink-inverse',
  /** The compact layout's row: the same items, side by side. */
  pill: 'inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-2.5 py-2 text-[13px] font-medium transition-colors',
  pillIdle: 'border-transparent text-ink-inverse/70 hover:text-ink-inverse',
  pillCurrent: 'border-primary text-ink-inverse',
} as const;

/**
 * Something that floats above the page (a menu, a dialog) must be opaque, so
 * it takes two layers: the navy on the outside, the raised tint inside.
 */
export const floating = {
  outer: 'overflow-hidden rounded-xl border border-white/15 bg-surface-dark shadow-2xl',
  inner: 'bg-white/[0.07]',
} as const;

export const menu = {
  item: 'flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] leading-5 text-ink-inverse/85 transition-colors hover:bg-white/10 hover:text-ink-inverse focus:bg-white/10 focus:text-ink-inverse aria-disabled:cursor-not-allowed aria-disabled:opacity-50',
  danger: 'text-red-300 hover:text-red-300 focus:text-red-300',
  groupLabel:
    'px-2.5 pb-1 pt-2 text-[11px] font-semibold uppercase leading-4 tracking-[0.08em] text-ink-inverse/60',
} as const;

/** A quiet block that stands in for content that is on its way. */
export const skeleton = 'rounded bg-white/10 motion-safe:animate-pulse';
