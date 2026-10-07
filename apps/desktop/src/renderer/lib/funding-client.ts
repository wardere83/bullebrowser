// The one way the renderer talks to the funding platform.
//
// Every funding call crosses to the main process and comes back as an Outcome:
// a value, or an error that is safe to show. Screens never read an Outcome by
// hand. They use `unwrap`, which returns the value or throws a
// FundingCallError, and `useAsync`, which turns a call into the loading /
// ready / error triad every screen renders the same way.
//
// The small formatters at the bottom are here for the same reason: one way to
// write a date, an amount or a file size, so screens do not each invent one.

import { useCallback, useEffect, useMemo, useRef, useState, type DependencyList } from 'react';
import type { Citation, FundingBridge, FundingErrorCode, OrgConsents, Outcome } from '../../shared/funding.js';

// ─────────────────────────────────── calls ────────────────────────────────────

/** The typed funding bridge the preload exposes. */
export function fundingBridge(): FundingBridge {
  return window.bullebrowser.funding;
}

/** Shown when a call never got an answer, for example while the app is starting. */
export const CALL_FAILED_MESSAGE = 'The app could not complete that. Please try again.';

/** A failed funding call. `message` is always safe to show as it is. */
export class FundingCallError extends Error {
  readonly code: FundingErrorCode;
  /** With CONSENT_REQUIRED: the acknowledgement main is waiting for. */
  readonly consent: keyof OrgConsents | null;

  constructor(code: FundingErrorCode, message: string, consent: keyof OrgConsents | null = null) {
    super(message);
    this.name = 'FundingCallError';
    this.code = code;
    this.consent = consent;
  }
}

/** Anything caught around a funding call, as an error that is safe to show. */
export function toCallError(error: unknown): FundingCallError {
  return error instanceof FundingCallError
    ? error
    : new FundingCallError('INTERNAL', CALL_FAILED_MESSAGE);
}

/** True when `error` is a funding error with one of the given codes. */
export function hasErrorCode(error: unknown, ...codes: FundingErrorCode[]): boolean {
  return error instanceof FundingCallError && codes.includes(error.code);
}

function isOutcome<T>(value: unknown): value is Outcome<T> {
  if (typeof value !== 'object' || value === null) return false;
  const outcome = value as { ok?: unknown; error?: { code?: unknown; message?: unknown } | null };
  if (outcome.ok === true) return true;
  return (
    outcome.ok === false &&
    typeof outcome.error === 'object' &&
    outcome.error !== null &&
    typeof outcome.error.code === 'string' &&
    typeof outcome.error.message === 'string'
  );
}

/**
 * Returns the value of a funding call, or throws a FundingCallError.
 *
 * Pass the call itself, or a function that makes it. A call that is rejected
 * (the main process did not answer) and an answer that is not an Outcome both
 * become an INTERNAL error with a message that is safe to show.
 */
export async function unwrap<T>(
  call: Promise<Outcome<T>> | (() => Promise<Outcome<T>>),
): Promise<T> {
  let outcome: unknown;
  try {
    outcome = await (typeof call === 'function' ? call() : call);
  } catch {
    throw new FundingCallError('INTERNAL', CALL_FAILED_MESSAGE);
  }
  if (!isOutcome<T>(outcome)) throw new FundingCallError('INTERNAL', CALL_FAILED_MESSAGE);
  if (outcome.ok) return outcome.value;
  const consent = outcome.error.consent;
  throw new FundingCallError(
    outcome.error.code,
    outcome.error.message || CALL_FAILED_MESSAGE,
    consent === 'documentAnalysisAt' || consent === 'liveFundingSearchAt' ? consent : null,
  );
}

// ───────────────────────────── loading / ready / error ─────────────────────────

/**
 * What a screen renders from.
 *  loading — nothing to show yet for the current dependencies.
 *  ready   — `value` is the latest result; `refreshing` is true while a reload runs.
 *  error   — `error.message` can be shown; `value` still holds the last good
 *            result when a reload failed, and is undefined otherwise.
 */
export type AsyncSnapshot<T> =
  | { state: 'loading'; value: undefined; error: undefined; refreshing: false }
  | { state: 'ready'; value: T; error: undefined; refreshing: boolean }
  | { state: 'error'; value: T | undefined; error: FundingCallError; refreshing: false };

export type AsyncResult<T> = AsyncSnapshot<T> & {
  /** Runs the call again. Keeps the current value on screen while it does. */
  reload(): void;
};

const LOADING: AsyncSnapshot<never> = {
  state: 'loading',
  value: undefined,
  error: undefined,
  refreshing: false,
};

export interface Loader<T> {
  /** Starts over with a new call: whatever was held is dropped. */
  start(load: () => Promise<T>): void;
  /** Runs the same call again, keeping the held value until the answer arrives. */
  reload(): void;
  /** Nothing is published after this. */
  dispose(): void;
}

/**
 * The logic behind `useAsync`, kept apart from React so it can be tested.
 * Only the most recent run may publish: an answer from an earlier run, or one
 * that arrives after `dispose`, is dropped.
 */
export function createLoader<T>(publish: (snapshot: AsyncSnapshot<T>) => void): Loader<T> {
  let generation = 0;
  let disposed = false;
  let current: AsyncSnapshot<T> = LOADING;
  let source: (() => Promise<T>) | null = null;

  const emit = (snapshot: AsyncSnapshot<T>) => {
    if (snapshot === current) return;
    current = snapshot;
    publish(snapshot);
  };

  const run = (keepValue: boolean) => {
    if (disposed || !source) return;
    const load = source;
    generation += 1;
    const id = generation;
    const held = keepValue ? current.value : undefined;
    emit(
      held === undefined
        ? LOADING
        : { state: 'ready', value: held, error: undefined, refreshing: true },
    );
    // Deferred by one microtask so a call that throws at once is reported the
    // same way as one that is rejected later.
    Promise.resolve()
      .then(load)
      .then(
        (value) => {
          if (disposed || id !== generation) return;
          emit({ state: 'ready', value, error: undefined, refreshing: false });
        },
        (error: unknown) => {
          if (disposed || id !== generation) return;
          emit({ state: 'error', value: held, error: toCallError(error), refreshing: false });
        },
      );
  };

  return {
    start(load) {
      source = load;
      run(false);
    },
    reload() {
      run(true);
    },
    dispose() {
      disposed = true;
    },
  };
}

function sameDependencies(a: DependencyList, b: DependencyList): boolean {
  return a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
}

/**
 * Runs `load` when the component mounts and whenever `deps` change, and
 * reports where it has got to. Use it for every read from the bridge:
 *
 *   const saved = useAsync(() => unwrap(fundingBridge().opportunities.listSaved()), []);
 *   if (saved.state === 'loading') return <LoadingBlock label="Loading saved opportunities" />;
 *   if (saved.state === 'error') return <InlineAlert tone="error">{saved.error.message}</InlineAlert>;
 *   return <List items={saved.value} />;
 *
 * A result from an outdated call is ignored, nothing is set after unmount, and
 * a change of `deps` never shows the previous result, not even for one frame.
 */
export function useAsync<T>(load: () => Promise<T>, deps: DependencyList): AsyncResult<T> {
  const [held, setHeld] = useState<{ deps: DependencyList; snapshot: AsyncSnapshot<T> }>({
    deps,
    snapshot: LOADING,
  });
  const loaderRef = useRef<Loader<T> | null>(null);

  useEffect(() => {
    const loader = createLoader<T>((snapshot) => setHeld({ deps, snapshot }));
    loaderRef.current = loader;
    loader.start(load);
    return () => {
      loader.dispose();
      if (loaderRef.current === loader) loaderRef.current = null;
    };
    // The caller's dependency list decides when to load again, exactly as it
    // would for an effect; `load` is read at that moment.
  }, deps);

  const reload = useCallback(() => loaderRef.current?.reload(), []);
  // Until the effect for new dependencies has run, the held result belongs to
  // the previous ones and must not be shown.
  const snapshot: AsyncSnapshot<T> = sameDependencies(held.deps, deps) ? held.snapshot : LOADING;
  return useMemo(() => ({ ...snapshot, reload }), [snapshot, reload]);
}

// ───────────────────────────────── formatters ─────────────────────────────────

/** What the product says when a source or document leaves something out. */
export const NOT_STATED = 'Not stated';

// The interface is English, so dates and amounts follow an English locale: the
// system's when it is one, United States English otherwise.
function displayLocale(): string {
  const preferred = typeof navigator === 'undefined' ? '' : navigator.language;
  return /^en\b/i.test(preferred) ? preferred : 'en-US';
}

/**
 * A calendar date such as "Mar 12, 2026" from an ISO date (YYYY-MM-DD). The
 * date is shown as written, never shifted into the local time zone. Returns
 * "Not stated" for a missing or unreadable date.
 */
export function formatDate(isoDate: string | null | undefined, locale = displayLocale()): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoDate ?? '');
  if (!match) return NOT_STATED;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  const valid =
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  if (!valid) return NOT_STATED;
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}

/** A moment such as "Mar 12, 2026, 3:45 PM", in the local time zone. */
export function formatDateTime(
  ms: number | null | undefined,
  locale = displayLocale(),
  timeZone?: string,
): string {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return 'Not recorded';
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    ...(timeZone ? { timeZone } : {}),
  }).format(new Date(ms));
}

/** The day of a moment, such as "Mar 12, 2026", in the local time zone. */
export function formatDay(
  ms: number | null | undefined,
  locale = displayLocale(),
  timeZone?: string,
): string {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return 'Not recorded';
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    ...(timeZone ? { timeZone } : {}),
  }).format(new Date(ms));
}

/**
 * An amount such as "$250,000". Null means the source does not state one, and
 * reads "Not stated"; zero is a stated amount and is shown as zero.
 */
export function formatMoney(
  amount: number | null | undefined,
  currency: string,
  locale = displayLocale(),
): string {
  if (typeof amount !== 'number' || !Number.isFinite(amount)) return NOT_STATED;
  const fractionDigits = Number.isInteger(amount) ? 0 : 2;
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits,
    }).format(amount);
  } catch {
    // Not a currency code the platform knows: show the number with the code as given.
    const number = new Intl.NumberFormat(locale, { maximumFractionDigits: fractionDigits }).format(
      amount,
    );
    return currency ? `${number} ${currency}` : number;
  }
}

/** An award range: "$5,000 – $50,000", "From $5,000", "Up to $50,000" or "Not stated". */
export function formatRange(
  floor: number | null | undefined,
  ceiling: number | null | undefined,
  currency: string,
  locale = displayLocale(),
): string {
  const hasFloor = typeof floor === 'number' && Number.isFinite(floor);
  const hasCeiling = typeof ceiling === 'number' && Number.isFinite(ceiling);
  if (!hasFloor && !hasCeiling) return NOT_STATED;
  if (hasFloor && hasCeiling) {
    return floor === ceiling
      ? formatMoney(floor, currency, locale)
      : `${formatMoney(floor, currency, locale)} – ${formatMoney(ceiling, currency, locale)}`;
  }
  return hasFloor
    ? `From ${formatMoney(floor, currency, locale)}`
    : `Up to ${formatMoney(ceiling, currency, locale)}`;
}

/** A file size such as "640 KB" or "2.4 MB". */
export function formatFileSize(bytes: number | null | undefined): string {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes < 0) return 'Unknown size';
  const units = ['B', 'KB', 'MB', 'GB'] as const;
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const rounded = unit === 0 || value >= 100 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${rounded} ${units[unit]}`;
}

/** "1 document", "3 documents", "2 analyses" (pass the plural when it is not just an s). */
export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  const number = new Intl.NumberFormat('en-US').format(count);
  return `${number} ${count === 1 ? singular : plural}`;
}

/**
 * Where a citation points: the document's name, then "p. N" when the page is
 * known, or the section otherwise.
 */
export function formatCitationSource(
  citation: Pick<Citation, 'documentName' | 'page' | 'section'>,
): string {
  if (typeof citation.page === 'number') return `${citation.documentName}, p. ${citation.page}`;
  const section = citation.section.trim();
  return section ? `${citation.documentName}, ${section}` : citation.documentName;
}
