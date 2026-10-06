// Small, shared readers for what official sources send: HTML fragments, dates
// in several spellings and amounts as text. Each returns null rather than a
// guess when the value cannot be read.

import { normalizeIsoDate, todayIn } from './status.js';

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  hellip: '…',
  bull: '•',
  copy: '©',
  reg: '®',
  trade: '™',
  deg: '°',
  euro: '€',
  pound: '£',
};

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]{2,8});/gi, (whole, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return whole;
      // Control characters have no place in a listing.
      if (code < 32 && code !== 9 && code !== 10 && code !== 13) return ' ';
      return String.fromCodePoint(code);
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? whole;
  });
}

/** Plain text from an HTML fragment: no tags, scripts or styles, single spaces. */
export function stripHtml(html: string): string {
  const withoutBlocks = html
    .replace(/<(script|style|template|noscript)\b[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<\/?(p|div|br|li|ul|ol|tr|td|th|table|h[1-6]|section|article)\b[^>]*>/gi, ' ')
    .replace(/<[^>]*>/g, '');
  // Decode twice: several sources send entities that were escaped again.
  return decodeEntities(decodeEntities(withoutBlocks))
    .replace(/<[^>]*>/g, '')
    .replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function clampText(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

/**
 * A money amount as a number. Sources write "not stated" in many ways —
 * empty, "none", 0, "$0" or a token dollar — and all of those are null here,
 * because a real floor or ceiling of one dollar or less does not occur.
 */
export function parseAmount(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) && value > 1 ? value : null;
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!text) return null;
  const match = /^[^\d-]{0,4}(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?\s*(k|thousand|m|million|b|billion)?\s*$/i.exec(
    text.replace(/\s*(usd|eur|gbp|dollars?)\s*$/i, ''),
  );
  if (!match) return null;
  const base = Number(`${match[1]!.replace(/,/g, '')}${match[2] ?? ''}`);
  const unit = (match[3] ?? '').toLowerCase();
  const scale = unit.startsWith('k') || unit === 'thousand' ? 1e3 : unit.startsWith('m') ? 1e6 : unit.startsWith('b') ? 1e9 : 1;
  const amount = base * scale;
  return Number.isFinite(amount) && amount > 1 ? amount : null;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

const pad = (value: number) => String(value).padStart(2, '0');

function build(year: number, month: number, day: number): string | null {
  if (year < 100) return null;
  return normalizeIsoDate(`${String(year).padStart(4, '0')}-${pad(month)}-${pad(day)}`);
}

/**
 * The calendar date a source wrote, as YYYY-MM-DD, without shifting it to
 * another time zone. Understands ISO dates and date-times, numeric dates in
 * the stated order, and month names ("Nov 14, 2026", "14 November 2026").
 */
export function parseDate(value: unknown, numericOrder: 'mdy' | 'dmy' = 'mdy'): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!text) return null;

  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:[T\s]|$)/.exec(text);
  if (iso) return build(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  const compact = /^(\d{4})(\d{2})(\d{2})$/.exec(text);
  if (compact) return build(Number(compact[1]), Number(compact[2]), Number(compact[3]));

  const numeric = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})(?:\D|$)/.exec(text);
  if (numeric) {
    const first = Number(numeric[1]);
    const second = Number(numeric[2]);
    return numericOrder === 'mdy'
      ? build(Number(numeric[3]), first, second)
      : build(Number(numeric[3]), second, first);
  }

  const monthFirst = /^(?:[a-z]{3,9},?\s+)?([a-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})(?:\D|$)/i.exec(text);
  if (monthFirst) {
    const month = MONTHS.indexOf(monthFirst[1]!.slice(0, 3).toLowerCase());
    if (month >= 0) return build(Number(monthFirst[3]), month + 1, Number(monthFirst[2]));
  }
  const dayFirst = /^(?:[a-z]{3,9},?\s+)?(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]{3,9})\.?,?\s+(\d{4})(?:\D|$)/i.exec(text);
  if (dayFirst) {
    const month = MONTHS.indexOf(dayFirst[2]!.slice(0, 3).toLowerCase());
    if (month >= 0) return build(Number(dayFirst[3]), month + 1, Number(dayFirst[1]));
  }
  return null;
}

/** The calendar date of an instant (epoch ms or an ISO date-time with an offset) in a zone. */
export function dateOfInstant(instant: unknown, timeZone: string): string | null {
  const ms =
    typeof instant === 'number'
      ? instant
      : typeof instant === 'string' && /^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:?\d{2})$/.test(instant.trim())
        ? Date.parse(instant.trim())
        : NaN;
  if (!Number.isFinite(ms) || ms <= 0) return null;
  return normalizeIsoDate(todayIn(timeZone, ms));
}

/** Lower-cased words of a search box entry, without punctuation. */
export function queryTerms(query: string): string[] {
  return query
    .normalize('NFKC')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((term) => term.length > 1);
}
