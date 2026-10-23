import { describe, expect, it } from 'vitest';
import type { BlockKind, ExtractedBlock } from '../documents/types.js';
import { buildPassages } from './passages.js';

const DOC = '33333333-3333-4333-8333-333333333333';

type Spec = { kind?: BlockKind; text: string; page?: number | null; section?: string };

/** Blocks numbered b0001, b0002, … in the order given. */
function blocks(specs: Spec[]): ExtractedBlock[] {
  return specs.map((spec, index) => ({
    id: `b${String(index + 1).padStart(4, '0')}`,
    kind: spec.kind ?? 'paragraph',
    text: spec.text,
    page: spec.page ?? null,
    section: spec.section ?? '',
    headingLevel: spec.kind === 'heading' ? 1 : null,
  }));
}

const filler = (length: number, letter = 'x') => letter.repeat(length);

describe('buildPassages', () => {
  it('returns nothing for a document with no blocks', () => {
    expect(buildPassages(DOC, [])).toEqual([]);
  });

  it('starts a passage at each heading, with the heading as its first line', () => {
    const passages = buildPassages(
      DOC,
      blocks([
        { kind: 'heading', text: 'Our Mission' },
        { text: 'Harbor Lantern Collective strengthens economic mobility.', section: 'Our Mission' },
        { kind: 'heading', text: 'Our Vision' },
        { text: 'A neighborhood where every resident can thrive.', section: 'Our Vision' },
        { kind: 'list_item', text: 'We start from strengths.', section: 'Our Vision' },
      ]),
    );
    expect(passages).toEqual([
      {
        id: `${DOC}:b0001`,
        documentId: DOC,
        blockIds: ['b0001', 'b0002'],
        page: null,
        section: 'Our Mission',
        text: 'Our Mission\nHarbor Lantern Collective strengthens economic mobility.',
      },
      {
        id: `${DOC}:b0003`,
        documentId: DOC,
        blockIds: ['b0003', 'b0004', 'b0005'],
        page: null,
        section: 'Our Vision',
        text: 'Our Vision\nA neighborhood where every resident can thrive.\nWe start from strengths.',
      },
    ]);
  });

  it('keeps a title together with the heading and text beneath it', () => {
    const passages = buildPassages(
      DOC,
      blocks([
        { kind: 'heading', text: 'Who We Serve' },
        { kind: 'heading', text: 'Populations Served', section: 'Who We Serve' },
        { text: 'We serve adults aged 18 to 64.', section: 'Who We Serve › Populations Served' },
        { kind: 'heading', text: 'Geographic Scope', section: 'Who We Serve' },
        { text: "Our service area is Newark's East Ward.", section: 'Who We Serve › Geographic Scope' },
      ]),
    );
    expect(passages.map((passage) => passage.text)).toEqual([
      'Who We Serve\nPopulations Served\nWe serve adults aged 18 to 64.',
      "Geographic Scope\nOur service area is Newark's East Ward.",
    ]);
    expect(passages.map((passage) => passage.section)).toEqual([
      'Who We Serve › Populations Served',
      'Who We Serve › Geographic Scope',
    ]);
  });

  it('names the section of a passage that is only headings', () => {
    const passages = buildPassages(
      DOC,
      blocks([
        { kind: 'heading', text: 'Appendix', page: 1 },
        { kind: 'heading', text: 'Forms', section: 'Appendix', page: 1 },
        { text: 'Attachment F is on the next page.', section: 'Appendix › Forms', page: 2 },
      ]),
    );
    expect(passages.map((passage) => [passage.page, passage.section, passage.text])).toEqual([
      [1, 'Appendix › Forms', 'Appendix\nForms'],
      [2, 'Appendix › Forms', 'Attachment F is on the next page.'],
    ]);
    expect(buildPassages(DOC, blocks([{ kind: 'heading', text: 'Cover' }]))[0]?.section).toBe('Cover');
  });

  it('never lets a passage cross a page', () => {
    const passages = buildPassages(
      DOC,
      blocks([
        { text: 'Awards will range from $75,000 to $250,000.', page: 4 },
        { text: 'A total of $4,000,000 is available.', page: 4 },
        { text: 'The grant period is 24 months.', page: 5 },
        { text: 'Renewal funding may be considered.', page: 5 },
        { text: 'Paper applications will not be accepted.', page: 6 },
      ]),
    );
    expect(passages.map((passage) => [passage.page, passage.blockIds])).toEqual([
      [4, ['b0001', 'b0002']],
      [5, ['b0003', 'b0004']],
      [6, ['b0005']],
    ]);
  });

  it('treats a document without pages as one run, and a page as different from none', () => {
    const noPages = buildPassages(DOC, blocks([{ text: 'One.' }, { text: 'Two.' }]));
    expect(noPages).toHaveLength(1);
    expect(noPages[0]?.page).toBeNull();
    const mixed = buildPassages(DOC, blocks([{ text: 'One.', page: null }, { text: 'Two.', page: 1 }]));
    expect(mixed.map((passage) => passage.page)).toEqual([null, 1]);
  });

  it('fills a passage to the target and never past the maximum', () => {
    const passages = buildPassages(
      DOC,
      blocks([
        { text: filler(500, 'a') },
        { text: filler(300, 'b') },
        { text: filler(300, 'c') },
        { text: filler(900, 'd') },
        { text: filler(100, 'e') },
        { text: filler(100, 'f') },
      ]),
    );
    // 500 + 300 is under the target, so the third block joins (1,102 with line
    // breaks); the fourth would pass the maximum; the passage it starts has
    // reached the target, so the fifth starts another.
    expect(passages.map((passage) => passage.blockIds)).toEqual([
      ['b0001', 'b0002', 'b0003'],
      ['b0004'],
      ['b0005', 'b0006'],
    ]);
    expect(passages.map((passage) => passage.text.length)).toEqual([1102, 900, 201]);
    for (const passage of passages) expect(passage.text.length).toBeLessThanOrEqual(1600);
  });

  it('gives a block longer than the maximum a passage of its own, whole', () => {
    const long = filler(2500, 'z');
    const passages = buildPassages(
      DOC,
      blocks([{ text: 'Short introduction.' }, { text: long }, { text: 'Short conclusion.' }]),
    );
    expect(passages.map((passage) => passage.blockIds)).toEqual([['b0001'], ['b0002'], ['b0003']]);
    expect(passages[1]?.text).toBe(long);
  });

  it('keeps the heading that introduces an oversized block with it', () => {
    const long = filler(2500, 'z');
    const passages = buildPassages(
      DOC,
      blocks([{ text: 'Before.' }, { kind: 'heading', text: 'Narrative' }, { text: long, section: 'Narrative' }, { text: 'After.' }]),
    );
    expect(passages.map((passage) => passage.blockIds)).toEqual([['b0001'], ['b0002', 'b0003'], ['b0004']]);
    expect(passages[1]?.text).toBe(`Narrative\n${long}`);
  });

  it('keeps the rows of a table together even past the target', () => {
    const rows = Array.from({ length: 12 }, (_, n) => ({ kind: 'table_row' as const, text: `Row ${n + 1} | ${filler(100)}` }));
    const passages = buildPassages(DOC, blocks([{ kind: 'heading', text: 'Revenue' }, ...rows, { text: 'Approved by the Board.' }]));
    expect(passages).toHaveLength(2);
    expect(passages[0]?.blockIds).toHaveLength(13);
    expect(passages[0]?.text.length).toBeGreaterThan(900);
    expect(passages[0]?.text.length).toBeLessThanOrEqual(1600);
    expect(passages[1]?.blockIds).toEqual(['b0014']);
  });

  it('starts a table in a new passage rather than split it', () => {
    const rows = Array.from({ length: 10 }, (_, n) => ({ kind: 'table_row' as const, text: `Row ${n + 1} | ${filler(90)}` }));
    const passages = buildPassages(DOC, blocks([{ text: filler(700) }, ...rows]));
    // 700 characters of text plus a 1,000-character table would pass the maximum.
    expect(passages.map((passage) => passage.blockIds.length)).toEqual([1, 10]);
    expect(passages[1]?.blockIds[0]).toBe('b0002');
  });

  it('keeps a small table with the text that introduces it', () => {
    const passages = buildPassages(
      DOC,
      blocks([
        { text: 'Key dates are listed below.' },
        { kind: 'table_row', text: 'Milestone | Date' },
        { kind: 'table_row', text: 'Letters of intent due | March 5, 2027' },
        { kind: 'table_row', text: 'Full applications due | April 16, 2027 at 5:00 p.m. Eastern Time' },
      ]),
    );
    expect(passages).toHaveLength(1);
    expect(passages[0]?.text.split('\n')).toHaveLength(4);
  });

  it('splits a table longer than the maximum between rows, never inside one', () => {
    const rows = Array.from({ length: 40 }, (_, n) => ({ kind: 'table_row' as const, text: `Row ${n + 1} | ${filler(110)}` }));
    const source = blocks(rows);
    const passages = buildPassages(DOC, source);
    expect(passages.length).toBeGreaterThan(1);
    for (const passage of passages) expect(passage.text.length).toBeLessThanOrEqual(1600);
    // Every row is in exactly one passage, whole and in order.
    expect(passages.flatMap((passage) => passage.blockIds)).toEqual(source.map((block) => block.id));
    expect(passages.flatMap((passage) => passage.text.split('\n'))).toEqual(source.map((block) => block.text));
  });

  it('honours custom lengths and ignores unusable ones', () => {
    const source = blocks(Array.from({ length: 6 }, (_, n) => ({ text: `Sentence number ${n + 1} of the plan.` })));
    expect(buildPassages(DOC, source, { targetChars: 40, maxChars: 80 }).map((passage) => passage.blockIds.length)).toEqual([2, 2, 2]);
    // A maximum below the target is raised to it.
    expect(buildPassages(DOC, source, { targetChars: 60, maxChars: 10 }).every((passage) => passage.text.length <= 60)).toBe(true);
    for (const bad of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(buildPassages(DOC, source, { targetChars: bad, maxChars: bad })).toEqual(buildPassages(DOC, source));
    }
  });

  it('skips blocks with no text', () => {
    const passages = buildPassages(DOC, blocks([{ text: '' }, { text: '   ' }, { text: 'Real text.' }]));
    expect(passages).toEqual([
      { id: `${DOC}:b0003`, documentId: DOC, blockIds: ['b0003'], page: null, section: '', text: 'Real text.' },
    ]);
  });

  it('gives stable, unique ids and loses no block', () => {
    const source = blocks([
      { kind: 'heading', text: '1. Purpose', page: 1 },
      { text: filler(850), page: 1, section: '1. Purpose' },
      { text: filler(850), page: 1, section: '1. Purpose' },
      { kind: 'heading', text: '2. Priorities', page: 2 },
      { kind: 'list_item', text: 'Bilingual and multilingual training models.', page: 2, section: '2. Priorities' },
      { kind: 'list_item', text: 'Employer partnerships with documented hiring commitments.', page: 2, section: '2. Priorities' },
      { kind: 'table_row', text: 'Criterion | Points', page: 3 },
      { kind: 'table_row', text: 'Community need | 20', page: 3 },
    ]);
    const first = buildPassages(DOC, source);
    expect(buildPassages(DOC, source)).toEqual(first);
    expect(first.map((passage) => passage.id)).toEqual([`${DOC}:b0001`, `${DOC}:b0003`, `${DOC}:b0004`, `${DOC}:b0007`]);
    expect(new Set(first.map((passage) => passage.id)).size).toBe(first.length);
    expect(first.flatMap((passage) => passage.blockIds)).toEqual(source.map((block) => block.id));
    for (const passage of first) {
      const texts = passage.blockIds.map((id) => source.find((block) => block.id === id)?.text);
      expect(passage.text).toBe(texts.join('\n'));
    }
    // The same blocks under another document get that document's ids.
    expect(buildPassages('other', source).map((passage) => passage.id)).toEqual(['other:b0001', 'other:b0003', 'other:b0004', 'other:b0007']);
  });
});
