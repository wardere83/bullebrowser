// Class strings the pages share, so a button, a link or a heading looks the
// same wherever it appears.
//
// Teal carries the brand but cannot carry text against white: teal on white and
// white on teal are both 2.3:1, short of the 4.5:1 that body text needs and of
// the 3:1 a link's underline needs. So a filled teal control takes the charcoal
// ink (7:1), and on a light surface text and its underline are charcoal or
// gray, with teal as an accent beside them and on hover. Teal text is kept for
// dark surfaces, where it reads at 7:1.

export const button = {
  primary:
    'inline-flex items-center justify-center rounded-lg bg-primary px-6 py-3 text-sm font-semibold text-ink-primary transition-all duration-300 hover:scale-105 hover:bg-primary-hover',
  secondary:
    'inline-flex items-center justify-center rounded-lg bg-white px-6 py-3 text-sm font-semibold text-ink-primary transition-all duration-300 hover:scale-105 hover:bg-gray-200',
  small:
    'inline-flex items-center justify-center rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-ink-primary transition-colors hover:bg-primary-hover',
} as const;

export const link = {
  onLight:
    'font-semibold text-ink-primary underline decoration-2 underline-offset-4 transition-colors hover:decoration-primary',
  onDark: 'font-semibold text-primary underline underline-offset-4 transition-colors hover:text-white',
} as const;

export const eyebrow = {
  onLight: 'flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-ink-secondary',
  onDark: 'flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-primary',
} as const;

/** The short teal rule that opens an eyebrow. Decorative. */
export const eyebrowRule = 'h-0.5 w-5 shrink-0 rounded-full bg-primary';

export const heading = {
  section: 'mt-3 text-3xl font-bold tracking-tight sm:text-4xl',
  sub: 'text-lg font-semibold tracking-tight text-ink-primary',
} as const;

export const lead = 'mt-4 max-w-2xl text-[15px] leading-relaxed text-ink-secondary';

export const card = {
  /** A white card that lifts on hover; for grids on a light or muted band. */
  light:
    'h-full rounded-2xl border border-line bg-white p-6 shadow-sm transition-all duration-300 hover:-translate-y-1 hover:border-primary/40 hover:shadow-md',
  /** The slate card used inside a dark panel. */
  slate:
    'h-full rounded-3xl border border-slate-700 bg-slate-800/50 p-6 transition-all duration-300 hover:-translate-y-1 hover:border-primary/40',
  /** A large, quiet white card for a statement or a list. */
  statement: 'rounded-3xl border border-line bg-white p-8 shadow-sm md:p-10',
} as const;

/** A number in a teal disc, for steps and for the four options. */
export const numberDisc =
  'grid h-8 w-8 shrink-0 place-items-center rounded-full bg-primary text-sm font-semibold text-ink-primary';
