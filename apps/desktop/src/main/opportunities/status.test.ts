import { describe, expect, it } from 'vitest';
import type { Opportunity } from '../../shared/funding.js';
import { evaluateStatus, normalizeIsoDate, refreshStatus, STALE_AFTER_MS, todayIn, type StatusInput } from './status.js';

// Noon UTC on 6 October 2026.
const NOW = Date.UTC(2026, 9, 6, 12, 0, 0);
const base: StatusInput = {
  sourceState: 'open',
  closeDate: '2026-11-15',
  ongoing: false,
  hasOfficialUrl: true,
  contradiction: '',
  detailChecked: true,
  fetchedAt: NOW - 60_000,
  now: NOW,
  timeZone: 'America/New_York',
};

describe('evaluateStatus', () => {
  it('is active only for an open listing with a future deadline, read recently', () => {
    const result = evaluateStatus(base);
    expect(result.status).toBe('active');
    expect(result.statusReason).toMatch(/Closes November 15, 2026\.$/);
    expect(result.unverifiedReason).toBeNull();
  });

  it('treats a listing whose deadline is today as still open', () => {
    expect(evaluateStatus({ ...base, closeDate: '2026-10-06' }).status).toBe('active');
  });

  it('expires a listing whose deadline has passed even when the source still says open', () => {
    const result = evaluateStatus({ ...base, closeDate: '2026-10-05' });
    expect(result).toMatchObject({ status: 'expired', unverifiedReason: null });
    expect(result.statusReason).toBe('The deadline passed on October 5, 2026.');
  });

  it('uses the source time zone to decide what "today" is', () => {
    // 03:00 UTC on 7 Oct is still 6 Oct in New York but already 7 Oct in Brussels.
    const lateNight = Date.UTC(2026, 9, 7, 3, 0, 0);
    const input = { ...base, closeDate: '2026-10-06', now: lateNight, fetchedAt: lateNight };
    expect(evaluateStatus({ ...input, timeZone: 'America/New_York' }).status).toBe('active');
    expect(evaluateStatus({ ...input, timeZone: 'Europe/Brussels' }).status).toBe('expired');
    expect(todayIn('Not/AZone', lateNight)).toBe('2026-10-07');
  });

  it('expires anything the source lists as closed', () => {
    expect(evaluateStatus({ ...base, sourceState: 'closed', closeDate: '2027-01-01' }).status).toBe('expired');
  });

  it.each([
    ['a forecast', { sourceState: 'forecast' }, 'forecast'],
    ['an unknown state', { sourceState: 'unknown' }, 'detail_unavailable'],
    ['no deadline', { closeDate: null }, 'no_deadline'],
    ['an unreadable deadline', { closeDate: '11/15/2026' }, 'implausible_deadline'],
    ['an impossible date', { closeDate: '2026-02-31' }, 'implausible_deadline'],
    ['a placeholder deadline', { closeDate: '9999-12-31' }, 'implausible_deadline'],
    ['a deadline more than five years out', { closeDate: '2031-10-07' }, 'implausible_deadline'],
    ['a failed re-read', { detailChecked: false }, 'detail_unavailable'],
    ['its own text contradicting the flag', { contradiction: 'Archived. Not accepting proposals.' }, 'source_contradiction'],
    ['no official link', { hasOfficialUrl: false }, 'no_official_link'],
    ['a stale check', { fetchedAt: NOW - STALE_AFTER_MS - 1 }, 'stale'],
  ] as const)('is unverified for %s', (_label, patch, reason) => {
    const result = evaluateStatus({ ...base, ...patch } as StatusInput);
    expect(result.status).toBe('unverified');
    expect(result.unverifiedReason).toBe(reason);
    expect(result.statusReason.length).toBeGreaterThan(10);
  });

  it('accepts an ongoing listing with no deadline, and a source with no separate record', () => {
    const ongoing = evaluateStatus({ ...base, closeDate: null, ongoing: true, detailChecked: null });
    expect(ongoing.status).toBe('active');
    expect(ongoing.statusReason).toMatch(/no closing date/);
    expect(evaluateStatus({ ...base, closeDate: '2031-10-05' }).status).toBe('active');
  });

  it('never calls an expired listing unverified just because the link is missing', () => {
    expect(evaluateStatus({ ...base, hasOfficialUrl: false, closeDate: '2020-01-01' }).status).toBe('expired');
  });
});

describe('normalizeIsoDate', () => {
  it('keeps real dates and rejects everything else', () => {
    expect(normalizeIsoDate('2028-02-29')).toBe('2028-02-29');
    for (const bad of ['2027-02-29', '2026-13-01', '2026-1-1', '', null, undefined, 'soon']) {
      expect(normalizeIsoDate(bad)).toBeNull();
    }
  });
});

describe('refreshStatus', () => {
  const listing = {
    status: 'active',
    statusReason: 'Open at the source.',
    unverifiedReason: null,
    closeDate: '2026-11-15',
    fetchedAt: NOW,
  } as Opportunity;

  it('leaves a fresh active listing alone', () => {
    expect(refreshStatus(listing, NOW + 1000, 'UTC')).toBe(listing);
  });

  it('expires it once the deadline passes and marks it stale after a day', () => {
    expect(refreshStatus(listing, Date.UTC(2026, 10, 16, 12), 'UTC').status).toBe('expired');
    const stale = refreshStatus(listing, NOW + STALE_AFTER_MS + 1, 'UTC');
    expect(stale).toMatchObject({ status: 'unverified', unverifiedReason: 'stale' });
  });

  it('never makes a listing active', () => {
    const waiting = { ...listing, status: 'unverified', unverifiedReason: 'forecast' } as Opportunity;
    expect(refreshStatus(waiting, NOW, 'UTC')).toBe(waiting);
    const expired = { ...listing, status: 'expired', closeDate: '2026-01-01' } as Opportunity;
    expect(refreshStatus(expired, NOW, 'UTC')).toBe(expired);
  });
});
