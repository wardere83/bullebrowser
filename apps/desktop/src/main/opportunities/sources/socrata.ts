// Shared reader for the official open-data portals that run on Socrata: New
// York City's, the City of Los Angeles's and Montgomery County's. Each dataset
// answers a GET with a plain JSON array of rows.
//
// Three habits of these portals shape the code:
//   - a row simply leaves out a column it has no value for, so a missing key
//     means "not stated" and can never be told apart from a renamed column.
//     Every query therefore names the columns it wants: the portal refuses a
//     name it does not have, and the request fails instead of quietly
//     returning rows without that field;
//   - numbers arrive as text, and dates as timestamps with no zone attached;
//   - an error is an object, never an array.

import { FundingError } from '../../funding/errors.js';
import { formatDate, normalizeIsoDate } from '../status.js';
import type { SourceContext } from '../types.js';

/** What a column holds, as the portal types it. */
export type ColumnKind = 'text' | 'time' | 'link';

/** A date and time with no zone attached, which is how these portals store them. */
export interface FloatingTime {
  /** The value exactly as the row gives it. */
  written: string;
  /** Its calendar date (YYYY-MM-DD), or null when that is not a real date. */
  date: string | null;
  hour: number;
  minute: number;
}

export interface SocrataRow<C extends string> {
  /** A text or number column. Empty when the row has no value. */
  text(column: C): string;
  time(column: C): FloatingTime | null;
  /** The address in a link column. Empty when the row has none. */
  link(column: C): string;
}

export interface SocrataQuery<C extends string> {
  /** The dataset's address, ending in ".json". */
  resource: string;
  /** Every column to read, and what it holds. */
  columns: Readonly<Record<C, ColumnKind>>;
  where?: string;
  order: string;
  /** The most rows to accept. A read that fills it may have left rows behind. */
  limit: number;
}

/** The most of any one field that is read, so an absurd answer cannot stall the app. */
const MAX_FIELD_LENGTH = 80_000;
const FLOATING_RE = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):\d{2}(?:\.\d{1,6})?$/;

export const UNEXPECTED_FORM = 'its answer was not in the expected form.';

export const unavailable = (source: string, detail: string): FundingError =>
  new FundingError('SOURCE_UNAVAILABLE', `${source} could not be read: ${detail}`);

/** A piece of text as a literal in the portal's query language. */
export const literal = (value: string): string => `'${value.replace(/'/g, "''")}'`;

/** The request for a query, with every column asked for by name. */
export function socrataUrl<C extends string>(query: SocrataQuery<C>): string {
  const params = new URLSearchParams();
  params.set('$select', Object.keys(query.columns).join(','));
  if (query.where) params.set('$where', query.where);
  params.set('$order', query.order);
  params.set('$limit', String(query.limit));
  return `${query.resource}?${params.toString()}`;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function readTime(value: unknown): FloatingTime | undefined {
  const match = typeof value === 'string' ? FLOATING_RE.exec(value) : null;
  if (!match) return undefined;
  const hour = Number(match[2]);
  const minute = Number(match[3]);
  if (hour > 23 || minute > 59) return undefined;
  return { written: match[0], date: normalizeIsoDate(match[1]), hour, minute };
}

function readRow<C extends string>(
  raw: unknown,
  columns: Readonly<Record<C, ColumnKind>>,
  source: string,
): SocrataRow<C> {
  if (!isRecord(raw)) throw unavailable(source, UNEXPECTED_FORM);
  const texts = new Map<string, string>();
  const times = new Map<string, FloatingTime>();
  for (const [column, kind] of Object.entries(columns) as [C, ColumnKind][]) {
    const value = raw[column];
    if (value === undefined || value === null) continue;
    if (kind === 'time') {
      const time = readTime(value);
      if (!time) throw unavailable(source, UNEXPECTED_FORM);
      times.set(column, time);
    } else if (kind === 'link') {
      if (!isRecord(value) || typeof value.url !== 'string') throw unavailable(source, UNEXPECTED_FORM);
      texts.set(column, value.url.slice(0, MAX_FIELD_LENGTH));
    } else if (typeof value === 'string') {
      texts.set(column, value.slice(0, MAX_FIELD_LENGTH));
    } else if (typeof value === 'number' && Number.isFinite(value)) {
      texts.set(column, String(value));
    } else {
      throw unavailable(source, UNEXPECTED_FORM);
    }
  }
  return {
    text: (column) => texts.get(column) ?? '',
    time: (column) => times.get(column) ?? null,
    link: (column) => texts.get(column) ?? '',
  };
}

/** The rows a query matches, each checked against the kinds its columns should hold. */
export async function readRows<C extends string>(
  query: SocrataQuery<C>,
  source: string,
  context: SourceContext,
): Promise<SocrataRow<C>[]> {
  const reply = await context.http.json<unknown>({
    url: socrataUrl(query),
    signal: context.signal,
    source,
  });
  if (!Array.isArray(reply) || reply.length > query.limit) throw unavailable(source, UNEXPECTED_FORM);
  return reply.map((raw) => readRow(raw, query.columns, source));
}

/**
 * Every row a query matches. Filling the limit means there may be more, and a
 * list with an unknown number of rows missing is not one to show.
 */
export async function readEveryRow<C extends string>(
  query: SocrataQuery<C>,
  source: string,
  context: SourceContext,
): Promise<SocrataRow<C>[]> {
  const rows = await readRows(query, source, context);
  if (rows.length >= query.limit) {
    throw unavailable(source, 'it has more listings than can be read at once.');
  }
  return rows;
}

/** The same moment in a time zone, for a portal that stores its times in UTC. */
export function fromUtc(time: FloatingTime, timeZone: string): FloatingTime {
  const instant = Date.parse(`${time.written}Z`);
  if (!time.date || !Number.isFinite(instant)) return time;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(instant));
  const pick = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  const date = normalizeIsoDate(`${pick('year')}-${pick('month')}-${pick('day')}`);
  if (!date) return time;
  return { written: time.written, date, hour: Number(pick('hour')), minute: Number(pick('minute')) };
}

/**
 * A date as a person would write it: "November 2, 2026", with the time of day
 * when the source gives one ("at 5:00 PM"). Midnight is how these portals store
 * a date with no time. A value that is not a real date is shown as written.
 */
export function dateWording(time: FloatingTime): string {
  if (!time.date) return time.written;
  if (time.hour === 0 && time.minute === 0) return formatDate(time.date);
  const hour = time.hour % 12 === 0 ? 12 : time.hour % 12;
  const clock = `${hour}:${String(time.minute).padStart(2, '0')} ${time.hour < 12 ? 'AM' : 'PM'}`;
  return `${formatDate(time.date)} at ${clock}`;
}
