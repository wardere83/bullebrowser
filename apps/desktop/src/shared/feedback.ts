// Thumbs up and down on chat replies and strategy playbooks. Ratings stay on
// the device; the user chooses whether to email them to the team or save
// them as a file. These helpers are shared by main (which stores and sends)
// and the renderer (which shows the buttons).

export type FeedbackRating = 'up' | 'down';
export type FeedbackKind = 'reply' | 'strategy';

export interface FeedbackEntry {
  /** One rating per item: `<conversationId>:<index>` or `strategy:<runId>`. */
  key: string;
  kind: FeedbackKind;
  rating: FeedbackRating;
  comment: string;
  /** The start of what was rated, so the rating can be understood later. */
  excerpt: string;
  version: string;
  at: number;
}

export interface FeedbackInput {
  key: string;
  kind: FeedbackKind;
  /** null removes the rating. */
  rating: FeedbackRating | null;
  comment?: string;
  excerpt?: string;
}

export const FEEDBACK_COMMENT_MAX = 1000;
export const FEEDBACK_EXCERPT_MAX = 240;
export const FEEDBACK_MAX_ENTRIES = 500;
export const FEEDBACK_ADDRESS = 'support@bullebrowser.com';
// Mail apps cut long mailto links, so the email holds the newest ratings that
// fit and points to the saved file for the rest.
const MAILTO_BODY_MAX = 1800;

const oneLine = (text: string) => text.replace(/\s+/g, ' ').trim();

function clip(text: string, max: number): string {
  const flat = oneLine(text);
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}

/** Validates renderer input. Returns null for anything malformed. */
export function normalizeFeedbackInput(input: unknown): FeedbackInput | null {
  if (!input || typeof input !== 'object') return null;
  const value = input as Record<string, unknown>;
  const key = typeof value.key === 'string' ? value.key.trim() : '';
  if (!key || key.length > 200) return null;
  if (value.kind !== 'reply' && value.kind !== 'strategy') return null;
  if (value.rating !== 'up' && value.rating !== 'down' && value.rating !== null) return null;
  return {
    key,
    kind: value.kind,
    rating: value.rating,
    comment: typeof value.comment === 'string' ? value.comment.trim().slice(0, FEEDBACK_COMMENT_MAX) : '',
    excerpt: typeof value.excerpt === 'string' ? clip(value.excerpt, FEEDBACK_EXCERPT_MAX) : '',
  };
}

/** Applies one rating to the saved list: newest first, one entry per key. */
export function applyFeedback(entries: readonly FeedbackEntry[], input: FeedbackInput, version: string, now: number): FeedbackEntry[] {
  const rest = entries.filter((entry) => entry.key !== input.key);
  if (input.rating === null) return rest;
  const previous = entries.find((entry) => entry.key === input.key);
  const entry: FeedbackEntry = {
    key: input.key,
    kind: input.kind,
    rating: input.rating,
    comment: input.comment ?? '',
    excerpt: input.excerpt || previous?.excerpt || '',
    version,
    at: now,
  };
  return [entry, ...rest].slice(0, FEEDBACK_MAX_ENTRIES);
}

function describe(entry: FeedbackEntry, index: number): string {
  const what = entry.kind === 'strategy' ? 'a strategy playbook' : 'a chat reply';
  const date = new Date(entry.at).toISOString().slice(0, 10);
  const lines = [`${index + 1}. ${entry.rating === 'up' ? 'Thumbs up' : 'Thumbs down'} on ${what}, ${date}, version ${entry.version}`];
  if (entry.comment) lines.push(`Comment: ${oneLine(entry.comment)}`);
  if (entry.excerpt) lines.push(`It began: "${entry.excerpt}"`);
  return lines.join('\n');
}

/** A mailto link the user's own mail app opens; the user decides whether to send it. */
export function feedbackMailto(entries: readonly FeedbackEntry[], version: string): string {
  const up = entries.filter((entry) => entry.rating === 'up').length;
  let body = `BulleBrowser feedback from version ${version}: ${up} thumbs up, ${entries.length - up} thumbs down.`;
  // Room kept for the closing note when not every rating fits.
  const room = MAILTO_BODY_MAX - 300;
  for (const [index, entry] of entries.entries()) {
    const next = `${body}\n\n${describe(entry, index)}`;
    if (encodeURIComponent(next).length > room) {
      body += `\n\n${entries.length - index} more ratings did not fit in this email. Use Save as file in Settings to share them all.`;
      break;
    }
    body = next;
  }
  return `mailto:${FEEDBACK_ADDRESS}?subject=${encodeURIComponent('BulleBrowser feedback')}&body=${encodeURIComponent(body)}`;
}

export function feedbackExport(entries: readonly FeedbackEntry[], version: string, now: number): string {
  return JSON.stringify({ app: 'BulleBrowser', version, exportedAt: new Date(now).toISOString(), entries }, null, 2);
}
