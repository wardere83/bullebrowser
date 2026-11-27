import { describe, expect, it } from 'vitest';
import { applyFeedback, feedbackExport, feedbackMailto, normalizeFeedbackInput, type FeedbackEntry } from './feedback.js';

const entry = (key: string, rating: 'up' | 'down', extra: Partial<FeedbackEntry> = {}): FeedbackEntry =>
  ({ key, kind: 'reply', rating, comment: '', excerpt: '', version: '0.2.105', at: Date.UTC(2026, 10, 27), ...extra });

describe('feedback input', () => {
  it('accepts a rating, trims the comment and shortens the excerpt to one line', () => {
    const input = normalizeFeedbackInput({ key: 'c1:3', kind: 'reply', rating: 'down', comment: '  Missed the deadline  ', excerpt: `Line one\n\n${'x'.repeat(400)}` });
    expect(input?.comment).toBe('Missed the deadline');
    expect((input?.excerpt ?? '').startsWith('Line one x')).toBe(true);
    expect((input?.excerpt ?? '').length).toBeLessThanOrEqual(240);
  });

  it.each([null, {}, { key: '', kind: 'reply', rating: 'up' }, { key: 'a', kind: 'other', rating: 'up' }, { key: 'a', kind: 'reply', rating: 'meh' }])(
    'refuses malformed input %#', (value) => expect(normalizeFeedbackInput(value)).toBeNull());
});

describe('applying feedback', () => {
  it('keeps one rating per item, newest first, and removes it when cleared', () => {
    let list = applyFeedback([], { key: 'a', kind: 'reply', rating: 'up', excerpt: 'Hello' }, '0.2.105', 1);
    list = applyFeedback(list, { key: 'b', kind: 'strategy', rating: 'down' }, '0.2.105', 2);
    list = applyFeedback(list, { key: 'a', kind: 'reply', rating: 'down', comment: 'Too long' }, '0.2.105', 3);
    expect(list.map((e) => [e.key, e.rating])).toEqual([['a', 'down'], ['b', 'down']]);
    expect(list[0]!.excerpt).toBe('Hello');
    expect(list[0]!.comment).toBe('Too long');
    expect(applyFeedback(list, { key: 'a', kind: 'reply', rating: null }, '0.2.105', 4).map((e) => e.key)).toEqual(['b']);
  });
});

describe('sharing feedback', () => {
  it('fills an email to the team that the user sends themselves', () => {
    const link = feedbackMailto([entry('a', 'down', { comment: 'Wrong date', excerpt: 'The deadline is' }), entry('b', 'up', { kind: 'strategy' })], '0.2.105');
    expect(link.startsWith('mailto:support@bullebrowser.com?subject=BulleBrowser%20feedback&body=')).toBe(true);
    const body = decodeURIComponent(link.split('&body=')[1]!);
    expect(body).toContain('1 thumbs up, 1 thumbs down');
    expect(body).toContain('Thumbs down on a chat reply, 2026-11-27');
    expect(body).toContain('Comment: Wrong date');
    expect(body).toContain('Thumbs up on a strategy playbook');
  });

  it('keeps the email short enough for mail apps and points to the file for the rest', () => {
    const many = Array.from({ length: 60 }, (_, i) => entry(`k${i}`, 'down', { comment: 'c'.repeat(200) }));
    const link = feedbackMailto(many, '0.2.105');
    expect(link.length).toBeLessThan(2100);
    expect(decodeURIComponent(link.split('&body=')[1]!)).toMatch(/more ratings did not fit in this email/);
  });

  it('exports every rating as JSON', () => {
    const json = JSON.parse(feedbackExport([entry('a', 'up')], '0.2.105', Date.UTC(2026, 10, 27)));
    expect(json).toMatchObject({ app: 'BulleBrowser', version: '0.2.105', entries: [{ key: 'a', rating: 'up' }] });
  });
});
