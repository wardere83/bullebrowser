import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { HttpClient, HttpRequest } from '../http.js';
import type { SourceContext } from '../types.js';
import {
  dateWording,
  fromUtc,
  literal,
  readEveryRow,
  readRows,
  socrataUrl,
  type ColumnKind,
  type FloatingTime,
  type SocrataQuery,
} from './socrata.js';

// The rows below are the Los Angeles answer recorded on 6 October 2026 (see the
// README beside the fixtures). Where a test needs an answer the portal did not
// give that day, it changes one field of a recorded row and says so.

type Loose = Record<string, unknown>;

const recorded = JSON.parse(
  readFileSync(new URL('../../../../test-fixtures/funding/sources/la-ramp/search.json', import.meta.url), 'utf8'),
) as { request: { url: string }; response: Loose[] };

const COLUMNS = {
  rampid: 'text',
  title: 'text',
  stagename: 'text',
  category: 'text',
  type: 'text',
  bidpost: 'time',
  closedate: 'time',
  department: 'text',
  url: 'link',
} as const satisfies Record<string, ColumnKind>;

const QUERY: SocrataQuery<keyof typeof COLUMNS> = {
  resource: 'https://data.lacity.org/resource/hf3r-utnq.json',
  columns: COLUMNS,
  order: 'closedate ASC, rampid ASC',
  limit: 5000,
};

function answering(response: unknown) {
  const calls: HttpRequest[] = [];
  const http: HttpClient = {
    async json<T>(request: HttpRequest): Promise<T> {
      calls.push(request);
      return structuredClone(response) as T;
    },
    async text(): Promise<string> {
      throw new Error('The reader only asks for JSON.');
    },
  };
  const context: SourceContext = { http, now: Date.UTC(2026, 9, 6, 12), signal: new AbortController().signal };
  return { context, calls };
}

const rows = () => structuredClone(recorded.response);
/** The recorded rows with one field of the first row replaced. */
const withFirst = (patch: Loose): Loose[] => rows().map((row, at) => (at === 0 ? { ...row, ...patch } : row));

describe('a query to an open-data portal', () => {
  it('names every column it wants, so a renamed column fails at the source', () => {
    const url = new URL(socrataUrl(QUERY));
    expect(socrataUrl(QUERY)).toBe(recorded.request.url);
    expect(url.origin + url.pathname).toBe('https://data.lacity.org/resource/hf3r-utnq.json');
    expect(url.searchParams.get('$select')).toBe('rampid,title,stagename,category,type,bidpost,closedate,department,url');
    expect(url.searchParams.get('$order')).toBe('closedate ASC, rampid ASC');
    expect(url.searchParams.get('$limit')).toBe('5000');
    expect(url.searchParams.has('$where')).toBe(false);
  });

  it('carries a condition and quotes text so that it cannot end the literal', () => {
    const where = `department=${literal("Mayor's Office")} AND rampid=${literal("1' OR '1'='1")}`;
    const url = new URL(socrataUrl({ ...QUERY, where }));
    expect(url.searchParams.get('$where')).toBe("department='Mayor''s Office' AND rampid='1'' OR ''1''=''1'");
  });
});

describe('reading rows', () => {
  it('sends one request and returns each row with text, times and links read by kind', async () => {
    const source = answering(rows());
    const read = await readRows(QUERY, 'RAMP Los Angeles', source.context);

    expect(source.calls).toHaveLength(1);
    expect(source.calls[0]).toMatchObject({ url: recorded.request.url, source: 'RAMP Los Angeles' });
    expect(read).toHaveLength(recorded.response.length);

    const first = read[0]!;
    expect(first.text('rampid')).toBe('232282');
    expect(first.text('title')).toBe('MANUAL HEIGHT ADJUSTERS AND INSTALLATION');
    expect(first.time('closedate')).toEqual({
      written: '2026-10-06T18:00:00.000',
      date: '2026-10-06',
      hour: 18,
      minute: 0,
    });
    expect(first.link('url')).toBe('https://www.rampla.org/s/opportunity-details?id=006Ql00000mLP4bIAG');
  });

  it('reads a column the row leaves out as not stated, never as an error', async () => {
    // The portal omits a column that has no value: the cancelled listing has no closing date.
    const read = await readRows(QUERY, 'RAMP Los Angeles', answering(rows()).context);
    const cancelled = read.find((row) => row.text('rampid') === '229205')!;
    expect(cancelled.time('closedate')).toBeNull();
    expect(cancelled.time('bidpost')?.date).toBe('2026-04-13');

    // Changed: the first row has its link and department removed.
    const bare = rows();
    delete bare[0]!.url;
    delete bare[0]!.department;
    const [first] = await readRows(QUERY, 'RAMP Los Angeles', answering(bare).context);
    expect(first!.link('url')).toBe('');
    expect(first!.text('department')).toBe('');
  });

  it('accepts a number where the portal sends one, and keeps a date that is not real as written', async () => {
    // Changed: the id as a number, and a closing date that no calendar has.
    const [first] = await readRows(
      QUERY,
      'RAMP Los Angeles',
      answering(withFirst({ rampid: 232282, closedate: '2026-02-30T12:00:00.000' })).context,
    );
    expect(first!.text('rampid')).toBe('232282');
    expect(first!.time('closedate')).toEqual({ written: '2026-02-30T12:00:00.000', date: null, hour: 12, minute: 0 });
  });

  it.each([
    ['an error object instead of rows', { message: 'Invalid SoQL query', errorCode: 'query.soql.no-such-column', error: true }],
    ['nothing', null],
    ['a row that is not an object', ['232282']],
    ['text where a number or text belongs', withFirst({ title: { value: 'x' } })],
    ['a true-or-false value where text belongs', withFirst({ stagename: true })],
    ['a date that is not a timestamp', withFirst({ closedate: '10/14/2026 3:00 PM' })],
    ['a date with an impossible time', withFirst({ closedate: '2026-10-14T25:00:00.000' })],
    ['a date given as a number', withFirst({ bidpost: 1791460800000 })],
    ['a link that is plain text', withFirst({ url: 'https://www.rampla.org/' })],
    ['a link with no address', withFirst({ url: { description: 'Listing' } })],
  ])('refuses %s rather than guess at it', async (_label, response) => {
    const failure = readRows(QUERY, 'RAMP Los Angeles', answering(response).context);
    await expect(failure).rejects.toMatchObject({ code: 'SOURCE_UNAVAILABLE' });
    await expect(failure).rejects.toThrow(/^RAMP Los Angeles could not be read: its answer was not in the expected form\.$/);
  });

  it('refuses more rows than it asked for', async () => {
    const failure = readRows({ ...QUERY, limit: 3 }, 'RAMP Los Angeles', answering(rows()).context);
    await expect(failure).rejects.toMatchObject({ code: 'SOURCE_UNAVAILABLE' });
  });

  it('treats a read that fills its limit as incomplete when every row is needed', async () => {
    const twelve = rows();
    const full = readEveryRow({ ...QUERY, limit: twelve.length }, 'RAMP Los Angeles', answering(twelve).context);
    await expect(full).rejects.toThrow('RAMP Los Angeles could not be read: it has more listings than can be read at once.');

    const roomy = await readEveryRow({ ...QUERY, limit: twelve.length + 1 }, 'RAMP Los Angeles', answering(twelve).context);
    expect(roomy).toHaveLength(twelve.length);
    // A capped read may fill its limit: the caller asked for the latest few on purpose.
    expect(await readRows({ ...QUERY, limit: twelve.length }, 'RAMP Los Angeles', answering(twelve).context)).toHaveLength(
      twelve.length,
    );
  });

  it('passes on the failure of the request itself', async () => {
    const http: HttpClient = {
      async json<T>(): Promise<T> {
        throw new Error('The portal answered with status 400.');
      },
      async text(): Promise<string> {
        throw new Error('not used');
      },
    };
    const context: SourceContext = { http, now: 0, signal: new AbortController().signal };
    await expect(readRows(QUERY, 'RAMP Los Angeles', context)).rejects.toThrow('status 400');
  });
});

describe('times', () => {
  const time = (written: string): FloatingTime => ({
    written,
    date: written.slice(0, 10),
    hour: Number(written.slice(11, 13)),
    minute: Number(written.slice(14, 16)),
  });

  it('moves a UTC time into the zone the listing belongs to', () => {
    // 06:45 UTC on 31 October is 11:45 pm the evening before in Los Angeles.
    expect(fromUtc(time('2026-10-31T06:45:00.000'), 'America/Los_Angeles')).toEqual({
      written: '2026-10-31T06:45:00.000',
      date: '2026-10-30',
      hour: 23,
      minute: 45,
    });
    // After the clocks go back the same wall time is an hour earlier.
    expect(fromUtc(time('2026-12-18T20:00:00.000'), 'America/Los_Angeles')).toMatchObject({ date: '2026-12-18', hour: 12 });
    expect(fromUtc(time('2037-06-30T20:00:00.000'), 'America/Los_Angeles')).toMatchObject({ date: '2037-06-30', hour: 13 });
  });

  it('leaves a date that is not real exactly as written', () => {
    const unreal: FloatingTime = { written: '2026-02-30T12:00:00.000', date: null, hour: 12, minute: 0 };
    expect(fromUtc(unreal, 'America/Los_Angeles')).toBe(unreal);
    expect(dateWording(unreal)).toBe('2026-02-30T12:00:00.000');
  });

  it('words a date the way a person would, with the time only when there is one', () => {
    expect(dateWording(time('2026-11-06T00:00:00.000'))).toBe('November 6, 2026');
    expect(dateWording(time('2026-11-02T17:00:00.000'))).toBe('November 2, 2026 at 5:00 PM');
    expect(dateWording(time('2026-10-08T10:30:00.000'))).toBe('October 8, 2026 at 10:30 AM');
    expect(dateWording(time('2026-12-31T12:05:00.000'))).toBe('December 31, 2026 at 12:05 PM');
    expect(dateWording(time('2026-12-31T00:30:00.000'))).toBe('December 31, 2026 at 12:30 AM');
    expect(dateWording(time('9999-01-04T09:00:00.000'))).toBe('January 4, 9999 at 9:00 AM');
  });
});
