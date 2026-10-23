import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FundingBridge, Outcome } from '../../shared/funding.js';
import {
  CALL_FAILED_MESSAGE,
  FundingCallError,
  createLoader,
  formatCitationSource,
  formatDate,
  formatDateTime,
  formatDay,
  formatFileSize,
  formatMoney,
  formatRange,
  fundingBridge,
  hasErrorCode,
  pluralize,
  toCallError,
  unwrap,
  type AsyncSnapshot,
} from './funding-client.js';

const ok = <T>(value: T): Promise<Outcome<T>> => Promise.resolve({ ok: true, value });

/** A promise whose outcome the test decides later. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Lets every pending promise callback run. */
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fundingBridge', () => {
  it('is the funding bridge the preload exposes', () => {
    const funding = { onEvent: vi.fn() } as unknown as FundingBridge;
    vi.stubGlobal('window', { bullebrowser: { funding } });
    expect(fundingBridge()).toBe(funding);
  });
});

describe('unwrap', () => {
  it('returns the value of a successful call', async () => {
    await expect(unwrap(ok({ id: 'a' }))).resolves.toEqual({ id: 'a' });
    await expect(unwrap(ok(null))).resolves.toBeNull();
  });

  it('throws what main reported, with its code and message', async () => {
    const call = Promise.resolve<Outcome<string>>({
      ok: false,
      error: { code: 'FORBIDDEN', message: 'Your role cannot do that.' },
    });
    const error = await unwrap(call).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(FundingCallError);
    expect(error).toMatchObject({ code: 'FORBIDDEN', message: 'Your role cannot do that.' });
  });

  it('turns a rejected call into an error that is safe to show', async () => {
    const rejected = Promise.reject<Outcome<string>>(
      new Error("Error invoking remote method 'funding:call': no handler registered"),
    );
    const error = await unwrap(rejected).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(FundingCallError);
    expect(error).toMatchObject({
      code: 'INTERNAL',
      message: 'The app could not complete that. Please try again.',
    });
    expect(CALL_FAILED_MESSAGE).toBe('The app could not complete that. Please try again.');
  });

  it('treats an answer that is not an outcome as a failed call', async () => {
    for (const answer of [
      undefined,
      null,
      'ok',
      {},
      { ok: false },
      { ok: false, error: { code: 7 } },
    ]) {
      const error = await unwrap(Promise.resolve(answer as unknown as Outcome<string>)).catch(
        (caught: unknown) => caught,
      );
      expect(error).toMatchObject({ code: 'INTERNAL', message: CALL_FAILED_MESSAGE });
    }
  });

  it('accepts a function that makes the call, and catches it throwing at once', async () => {
    await expect(unwrap(() => ok(3))).resolves.toBe(3);
    const missingBridge = () => {
      throw new TypeError("Cannot read properties of undefined (reading 'identity')");
    };
    await expect(unwrap<number>(missingBridge)).rejects.toMatchObject({
      code: 'INTERNAL',
      message: CALL_FAILED_MESSAGE,
    });
  });

  it('never shows an empty message', async () => {
    const call = Promise.resolve<Outcome<string>>({
      ok: false,
      error: { code: 'BUSY', message: '' },
    });
    await expect(unwrap(call)).rejects.toMatchObject({
      code: 'BUSY',
      message: CALL_FAILED_MESSAGE,
    });
  });
});

describe('toCallError and hasErrorCode', () => {
  it('keeps a funding error and replaces anything else', () => {
    const known = new FundingCallError('NOT_FOUND', 'That document is no longer here.');
    expect(toCallError(known)).toBe(known);
    expect(toCallError(new Error('ENOENT: /Users/someone/secret'))).toMatchObject({
      code: 'INTERNAL',
      message: CALL_FAILED_MESSAGE,
    });
    expect(toCallError('boom').message).toBe(CALL_FAILED_MESSAGE);
  });

  it('matches codes only on funding errors', () => {
    const forbidden = new FundingCallError('FORBIDDEN', 'No.');
    expect(hasErrorCode(forbidden, 'FORBIDDEN')).toBe(true);
    expect(hasErrorCode(forbidden, 'NOT_FOUND', 'FORBIDDEN')).toBe(true);
    expect(hasErrorCode(forbidden, 'NOT_FOUND')).toBe(false);
    expect(hasErrorCode(new Error('FORBIDDEN'), 'FORBIDDEN')).toBe(false);
  });
});

describe('createLoader (the logic behind useAsync)', () => {
  function collect<T>() {
    const snapshots: AsyncSnapshot<T>[] = [];
    const loader = createLoader<T>((snapshot) => snapshots.push(snapshot));
    return { snapshots, loader, last: () => snapshots[snapshots.length - 1] };
  }

  it('goes from loading to ready', async () => {
    const { loader, snapshots } = collect<string>();
    loader.start(() => Promise.resolve('value'));
    await settle();
    // It starts in the loading state, so only the result is news.
    expect(snapshots).toEqual([
      { state: 'ready', value: 'value', error: undefined, refreshing: false },
    ]);
  });

  it('reports a failure as an error that is safe to show', async () => {
    const { loader, last } = collect<string>();
    loader.start(() => Promise.reject(new Error('socket hang up at 10.0.0.4')));
    await settle();
    expect(last()).toMatchObject({ state: 'error', value: undefined });
    expect(last()?.error).toMatchObject({ code: 'INTERNAL', message: CALL_FAILED_MESSAGE });
  });

  it('reports a call that throws at once the same way', async () => {
    const { loader, last } = collect<string>();
    loader.start(() => {
      throw new FundingCallError('NO_ASSISTANT', 'Connect an assistant first.');
    });
    await settle();
    expect(last()?.error).toMatchObject({
      code: 'NO_ASSISTANT',
      message: 'Connect an assistant first.',
    });
  });

  it('ignores the result of an outdated call', async () => {
    const { loader, snapshots, last } = collect<string>();
    const first = deferred<string>();
    const second = deferred<string>();
    loader.start(() => first.promise);
    loader.start(() => second.promise);
    second.resolve('second');
    await settle();
    first.resolve('first');
    await settle();
    expect(last()).toMatchObject({ state: 'ready', value: 'second' });
    expect(snapshots.some((snapshot) => snapshot.value === 'first')).toBe(false);
  });

  it('ignores an outdated failure too', async () => {
    const { loader, last } = collect<string>();
    const first = deferred<string>();
    loader.start(() => first.promise);
    loader.start(() => Promise.resolve('current'));
    await settle();
    first.reject(new Error('late'));
    await settle();
    expect(last()).toMatchObject({ state: 'ready', value: 'current' });
  });

  it('keeps the value on screen while it reloads', async () => {
    const { loader, snapshots } = collect<number>();
    let calls = 0;
    loader.start(() => Promise.resolve(++calls));
    await settle();
    loader.reload();
    expect(snapshots[snapshots.length - 1]).toEqual({
      state: 'ready',
      value: 1,
      error: undefined,
      refreshing: true,
    });
    await settle();
    expect(snapshots[snapshots.length - 1]).toEqual({
      state: 'ready',
      value: 2,
      error: undefined,
      refreshing: false,
    });
  });

  it('keeps the last good value when a reload fails', async () => {
    const { loader, last } = collect<string>();
    let fail = false;
    loader.start(() => (fail ? Promise.reject(new Error('down')) : Promise.resolve('good')));
    await settle();
    fail = true;
    loader.reload();
    await settle();
    expect(last()).toMatchObject({ state: 'error', value: 'good' });
    expect(last()?.error?.message).toBe(CALL_FAILED_MESSAGE);
  });

  it('shows loading again when a reload follows a failure with nothing to show', async () => {
    const { loader, snapshots } = collect<string>();
    let fail = true;
    loader.start(() => (fail ? Promise.reject(new Error('down')) : Promise.resolve('back')));
    await settle();
    fail = false;
    loader.reload();
    expect(snapshots[snapshots.length - 1]?.state).toBe('loading');
    await settle();
    expect(snapshots[snapshots.length - 1]).toMatchObject({ state: 'ready', value: 'back' });
  });

  it('starting over drops the value that was held', async () => {
    const { loader, snapshots } = collect<string>();
    loader.start(() => Promise.resolve('for the first document'));
    await settle();
    const next = deferred<string>();
    loader.start(() => next.promise);
    expect(snapshots[snapshots.length - 1]).toMatchObject({ state: 'loading', value: undefined });
  });

  it('publishes nothing after it is disposed', async () => {
    const { loader, snapshots } = collect<string>();
    const pending = deferred<string>();
    loader.start(() => pending.promise);
    loader.dispose();
    pending.resolve('too late');
    await settle();
    loader.reload();
    await settle();
    expect(snapshots).toEqual([]);
  });

  it('holds null as a value like any other', async () => {
    const { loader, last } = collect<string | null>();
    loader.start(() => Promise.resolve(null));
    await settle();
    expect(last()).toMatchObject({ state: 'ready', value: null });
    loader.reload();
    expect(last()).toMatchObject({ state: 'ready', value: null, refreshing: true });
  });
});

describe('formatters', () => {
  // Some platforms put a narrow no-break space before AM and PM.
  const plain = (text: string) => text.replace(/\s/g, ' ');

  it('formatDate shows a date as written, whatever the time zone', () => {
    expect(formatDate('2026-03-12', 'en-US')).toBe('Mar 12, 2026');
    expect(formatDate('2026-01-01', 'en-US')).toBe('Jan 1, 2026');
    expect(formatDate('2026-12-31', 'en-US')).toBe('Dec 31, 2026');
    expect(formatDate('2026-03-12T23:30:00-08:00', 'en-US')).toBe('Mar 12, 2026');
  });

  it('formatDate says "Not stated" for a missing or impossible date', () => {
    for (const value of [null, undefined, '', 'soon', '2026-02-30', '2026-13-01', '12/03/2026']) {
      expect(formatDate(value, 'en-US')).toBe('Not stated');
    }
  });

  it('formatDateTime and formatDay format a moment', () => {
    const moment = Date.UTC(2026, 2, 12, 15, 45);
    expect(plain(formatDateTime(moment, 'en-US', 'UTC'))).toBe('Mar 12, 2026, 3:45 PM');
    expect(formatDay(moment, 'en-US', 'UTC')).toBe('Mar 12, 2026');
    expect(formatDateTime(null)).toBe('Not recorded');
    expect(formatDateTime(Number.NaN)).toBe('Not recorded');
    expect(formatDay(undefined)).toBe('Not recorded');
  });

  it('formatMoney keeps null apart from zero', () => {
    expect(formatMoney(250000, 'USD', 'en-US')).toBe('$250,000');
    expect(formatMoney(1234.5, 'USD', 'en-US')).toBe('$1,234.50');
    expect(formatMoney(0, 'USD', 'en-US')).toBe('$0');
    expect(formatMoney(5000, 'EUR', 'en-US')).toBe('€5,000');
    expect(formatMoney(null, 'USD', 'en-US')).toBe('Not stated');
    expect(formatMoney(undefined, 'USD', 'en-US')).toBe('Not stated');
    expect(formatMoney(Number.NaN, 'USD', 'en-US')).toBe('Not stated');
  });

  it('formatMoney still shows the amount when the currency code is not usable', () => {
    expect(formatMoney(5000, 'dollars', 'en-US')).toBe('5,000 dollars');
    expect(formatMoney(5000, '', 'en-US')).toBe('5,000');
  });

  it('formatRange covers every combination of floor and ceiling', () => {
    expect(formatRange(null, null, 'USD', 'en-US')).toBe('Not stated');
    expect(formatRange(undefined, undefined, 'USD', 'en-US')).toBe('Not stated');
    expect(formatRange(5000, 50000, 'USD', 'en-US')).toBe('$5,000 – $50,000');
    expect(formatRange(5000, 5000, 'USD', 'en-US')).toBe('$5,000');
    expect(formatRange(5000, null, 'USD', 'en-US')).toBe('From $5,000');
    expect(formatRange(null, 50000, 'USD', 'en-US')).toBe('Up to $50,000');
    expect(formatRange(0, null, 'USD', 'en-US')).toBe('From $0');
  });

  it('formatFileSize picks a readable unit', () => {
    expect(formatFileSize(0)).toBe('0 B');
    expect(formatFileSize(512)).toBe('512 B');
    expect(formatFileSize(1024)).toBe('1 KB');
    expect(formatFileSize(1536)).toBe('1.5 KB');
    expect(formatFileSize(640 * 1024)).toBe('640 KB');
    expect(formatFileSize(2.4 * 1024 * 1024)).toBe('2.4 MB');
    expect(formatFileSize(40 * 1024 * 1024)).toBe('40 MB');
    expect(formatFileSize(3 * 1024 * 1024 * 1024)).toBe('3 GB');
    expect(formatFileSize(-1)).toBe('Unknown size');
    expect(formatFileSize(Number.NaN)).toBe('Unknown size');
    expect(formatFileSize(null)).toBe('Unknown size');
  });

  it('pluralize agrees with the count', () => {
    expect(pluralize(1, 'document')).toBe('1 document');
    expect(pluralize(3, 'document')).toBe('3 documents');
    expect(pluralize(0, 'document')).toBe('0 documents');
    expect(pluralize(2, 'analysis', 'analyses')).toBe('2 analyses');
    expect(pluralize(1200, 'listing')).toBe('1,200 listings');
  });

  it('formatCitationSource names the page when there is one, the section otherwise', () => {
    const base = { documentName: 'Strategic Plan 2026.pdf', page: null, section: '' };
    expect(formatCitationSource({ ...base, page: 12, section: 'Eligibility' })).toBe(
      'Strategic Plan 2026.pdf, p. 12',
    );
    expect(formatCitationSource({ ...base, section: 'Eligibility › Applicants' })).toBe(
      'Strategic Plan 2026.pdf, Eligibility › Applicants',
    );
    expect(formatCitationSource({ ...base, section: '   ' })).toBe('Strategic Plan 2026.pdf');
  });
});
