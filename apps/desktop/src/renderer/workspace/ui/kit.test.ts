import { describe, expect, it } from 'vitest';
import { OPPORTUNITY_STATUS_LABELS } from '../../../shared/funding.js';
import { ICON_NAMES } from './icons.js';
import { linkHost, safeExternalUrl } from './links.js';
import { rovingIndex } from './roving.js';
import { STATUS_TABLES } from './status.js';
import { badge } from './styles.js';

describe('status badges', () => {
  const tables = Object.entries(STATUS_TABLES);

  it('give every state words, a tone and an icon that exists', () => {
    for (const [kind, table] of tables) {
      for (const [status, presentation] of Object.entries(table)) {
        const where = `${kind}.${status}`;
        expect(presentation.label.trim(), where).not.toBe('');
        expect(Object.keys(badge.tone), where).toContain(presentation.tone);
        expect(ICON_NAMES, where).toContain(presentation.icon);
      }
    }
  });

  it('never use the same words for two states of one thing', () => {
    for (const [kind, table] of tables) {
      const labels = Object.values(table).map((presentation) => presentation.label);
      expect(new Set(labels).size, kind).toBe(labels.length);
    }
  });

  it('show a listing as Active, Expired or Unverified, each with its own shape', () => {
    const { opportunity } = STATUS_TABLES;
    expect(opportunity.active).toMatchObject({
      label: OPPORTUNITY_STATUS_LABELS.active,
      icon: 'check-circle',
    });
    expect(opportunity.expired).toMatchObject({
      label: OPPORTUNITY_STATUS_LABELS.expired,
      icon: 'clock',
    });
    expect(opportunity.unverified).toMatchObject({
      label: OPPORTUNITY_STATUS_LABELS.unverified,
      icon: 'question',
    });
    expect(opportunity.unverified.tone).toBe('caution');
  });

  it('tell a claim that is approved apart from the others by shape as well as colour', () => {
    const icons = Object.values(STATUS_TABLES.claim).map((presentation) => presentation.icon);
    expect(new Set(icons).size).toBe(icons.length);
  });

  it('keep to words that are free to use inside a button', () => {
    // A badge often sits inside a row that is itself a button, and one word is
    // reserved for the app's own dismiss buttons (see reserved.test.ts).
    for (const [, table] of tables) {
      for (const presentation of Object.values(table)) {
        expect(presentation.label).not.toMatch(/cancel/i);
      }
    }
    expect(STATUS_TABLES.job.cancelled.label).toBe('Stopped');
  });
});

describe('rovingIndex', () => {
  const all = [true, true, true];

  it('moves with the arrow keys and wraps at the ends', () => {
    expect(rovingIndex('ArrowRight', 0, all, 'horizontal')).toBe(1);
    expect(rovingIndex('ArrowRight', 2, all, 'horizontal')).toBe(0);
    expect(rovingIndex('ArrowLeft', 0, all, 'horizontal')).toBe(2);
    expect(rovingIndex('ArrowDown', 1, all, 'vertical')).toBe(2);
    expect(rovingIndex('ArrowUp', 0, all, 'vertical')).toBe(2);
  });

  it('goes to the first and last item with Home and End', () => {
    expect(rovingIndex('Home', 2, all, 'horizontal')).toBe(0);
    expect(rovingIndex('End', 0, all, 'vertical')).toBe(2);
  });

  it('skips what is disabled', () => {
    const middleOff = [true, false, true];
    expect(rovingIndex('ArrowRight', 0, middleOff, 'horizontal')).toBe(2);
    expect(rovingIndex('ArrowLeft', 2, middleOff, 'horizontal')).toBe(0);
    expect(rovingIndex('Home', 2, [false, true, true], 'horizontal')).toBe(1);
    expect(rovingIndex('End', 0, [true, true, false], 'horizontal')).toBe(1);
  });

  it('stays put when there is nowhere else to go', () => {
    expect(rovingIndex('ArrowRight', 1, [false, true, false], 'horizontal')).toBe(1);
    expect(rovingIndex('End', 0, [true, false, false], 'horizontal')).toBe(0);
  });

  it('starts from the right end when nothing has focus yet', () => {
    expect(rovingIndex('ArrowDown', -1, all, 'vertical')).toBe(0);
    expect(rovingIndex('ArrowUp', -1, all, 'vertical')).toBe(2);
  });

  it('ignores keys that do not move focus, and the other axis', () => {
    expect(rovingIndex('Enter', 0, all, 'horizontal')).toBeNull();
    expect(rovingIndex('a', 0, all, 'vertical')).toBeNull();
    expect(rovingIndex('ArrowDown', 0, all, 'horizontal')).toBeNull();
    expect(rovingIndex('ArrowRight', 0, all, 'vertical')).toBeNull();
  });

  it('does nothing when every item is disabled or there are none', () => {
    expect(rovingIndex('ArrowRight', 0, [false, false], 'horizontal')).toBeNull();
    expect(rovingIndex('Home', -1, [], 'horizontal')).toBeNull();
  });
});

describe('safeExternalUrl', () => {
  it('lets ordinary web addresses through', () => {
    expect(safeExternalUrl('https://www.grants.gov/search-results-detail/123')).toBe(
      'https://www.grants.gov/search-results-detail/123',
    );
    expect(safeExternalUrl('  http://example.org/page?x=1#top ')).toBe(
      'http://example.org/page?x=1#top',
    );
  });

  it('refuses anything that is not a web address', () => {
    for (const href of [
      'javascript:alert(1)',
      'file:///etc/passwd',
      'data:text/html,<p>hi</p>',
      'mailto:someone@example.org',
      'about:blank',
      'chrome://settings',
      '/relative/path',
      'grants.gov',
      'not a url',
      '',
      '   ',
      null,
      undefined,
    ]) {
      expect(safeExternalUrl(href), String(href)).toBeNull();
    }
  });

  it('refuses an address that carries a user name or password', () => {
    expect(safeExternalUrl('https://user:secret@example.org/')).toBeNull();
    expect(safeExternalUrl('https://grants.gov@evil.example/')).toBeNull();
  });

  it('names the site a link belongs to', () => {
    expect(linkHost('https://www.grants.gov/search')).toBe('grants.gov');
    expect(linkHost('https://data.ca.gov/dataset')).toBe('data.ca.gov');
    expect(linkHost('javascript:alert(1)')).toBe('');
  });
});
