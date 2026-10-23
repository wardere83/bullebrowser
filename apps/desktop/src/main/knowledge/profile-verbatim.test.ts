import { readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  KNOWLEDGE_CATEGORY_LABELS,
  PROFILE_FIELDS,
  type DocumentFormat,
  type KnowledgeCategory,
  type KnowledgePassage,
  type ProfileFieldId,
} from '../../shared/funding.js';
import { extractFromBytes } from '../documents/extract.js';
import type { BlockKind, ExtractedBlock } from '../documents/types.js';
import type { SourceDocument } from '../funding/pipeline.js';
import type { ExtractionInput, ExtractionOutcome, PassageSearch } from '../funding/services.js';
import { PROFILE_FIELD_QUERIES } from './field-queries.js';
import { buildPassages } from './passages.js';
import { extractProfile } from './profile-extraction.js';
import { MAX_OFFERED_PER_FIELD, gapNote, leadingSentences, offerPassages } from './profile-verbatim.js';
import { SearchIndex } from './search-index.js';

const fixtures = join(dirname(fileURLToPath(import.meta.url)), '../../../test-fixtures/funding');
const fixture = (name: string) => new Uint8Array(readFileSync(join(fixtures, name)));

type FixtureFile = [format: DocumentFormat, path: string, category: KnowledgeCategory];

// The sample CBO's documents that are not PDFs, then all of them.
const ORG_A_TYPED: FixtureFile[] = [
  ['txt', 'org-a/impact-report-2024.txt', 'impact_report'],
  ['md', 'org-a/program-descriptions.md', 'program_description'],
  ['docx', 'org-a/organizational-profile.docx', 'organizational_profile'],
  ['docx', 'org-a/previous-proposal-2023.docx', 'previous_proposal'],
];
const ORG_A_ALL: FixtureFile[] = [
  ...ORG_A_TYPED,
  ['pdf', 'org-a/strategic-plan-2025-2028.pdf', 'strategic_plan'],
  ['pdf', 'org-a/strategic-plan-2026-refresh.pdf', 'strategic_plan'],
  ['pdf', 'org-a/budget-fy2025.pdf', 'budget'],
];
const ORG_B: FixtureFile[] = [
  ['txt', 'org-b/business-profile.txt', 'organizational_profile'],
  ['docx', 'org-b/capability-statement.docx', 'other'],
];

/** Reads fixture files and indexes them the way the Knowledge Hub does. */
async function shelve(files: FixtureFile[]): Promise<{ documents: SourceDocument[]; search: PassageSearch }> {
  const index = new SearchIndex();
  const documents: SourceDocument[] = [];
  for (const [position, [format, path, category]] of files.entries()) {
    const extracted = await extractFromBytes(format, fixture(path));
    const id = `document-${position + 1}`;
    const name = basename(path);
    documents.push({ id, name, version: 1, label: KNOWLEDGE_CATEGORY_LABELS[category], blocks: extracted.blocks });
    index.add({ documentId: id, documentName: name, documentVersion: 1, category, passages: buildPassages(id, extracted.blocks) });
  }
  return { documents, search: async (query, limit) => index.search(query, { limit }) };
}

function read(input: Partial<ExtractionInput> & Pick<ExtractionInput, 'documents' | 'search'>): Promise<ExtractionOutcome> {
  return extractProfile({
    organization: { name: 'Harbor Lantern Collective', kind: 'cbo' },
    approved: [],
    complete: null,
    signal: new AbortController().signal,
    progress: () => {},
    ...input,
  });
}

const textsOf = (outcome: ExtractionOutcome, field: ProfileFieldId) =>
  outcome.claims.filter((claim) => claim.field === field).map((claim) => claim.text);

/** Every promise the verbatim method makes about one outcome, checked against the stored blocks. */
function expectWordForWord(outcome: ExtractionOutcome, documents: SourceDocument[]): void {
  expect(outcome.method).toBe('verbatim');
  expect(outcome.conflicts).toEqual([]);
  expect(outcome.claims.length).toBeGreaterThan(0);

  const citedBlocks: string[] = [];
  for (const claim of outcome.claims) {
    expect(claim.origin).toBe('verbatim');
    expect(claim.supersedesClaimId).toBeNull();
    expect(claim.citations.length).toBeGreaterThan(0);
    // Nothing reworded and nothing added: the text is its quotations, in order.
    expect(claim.text).toBe(claim.citations.map((citation) => citation.quote).join('\n'));
    expect(claim.text.length).toBeLessThanOrEqual(480);

    for (const citation of claim.citations) {
      const document = documents.find((entry) => entry.id === citation.documentId);
      const block = document?.blocks.find((entry) => entry.id === citation.blockId);
      expect(block, `${citation.documentName} ${citation.blockId}`).toBeDefined();
      expect(block?.kind).not.toBe('heading');
      expect(block?.text.includes(citation.quote)).toBe(true);
      // Whole sentences from the start of the block: all of it, or up to a full stop.
      expect(block?.text.startsWith(citation.quote)).toBe(true);
      expect(citation.quote === block?.text || /[.!?]$/.test(citation.quote)).toBe(true);
      expect(citation).toMatchObject({
        documentName: document?.name,
        documentVersion: document?.version,
        page: block?.page,
        section: block?.section,
        match: 'exact',
      });
      citedBlocks.push(`${citation.documentId}:${citation.blockId}`);
    }
  }
  // No passage, and no wording, is offered twice.
  expect(new Set(citedBlocks).size).toBe(citedBlocks.length);
  expect(new Set(outcome.claims.map((claim) => claim.text)).size).toBe(outcome.claims.length);

  for (const field of PROFILE_FIELDS) {
    expect(textsOf(outcome, field).length).toBeLessThanOrEqual(MAX_OFFERED_PER_FIELD);
  }
  // A gap for exactly the fields with nothing offered, in the app's own words.
  const offered = new Set(outcome.claims.map((claim) => claim.field));
  expect(outcome.gaps).toEqual(
    PROFILE_FIELDS.filter((field) => !offered.has(field)).map((field) => ({ field, note: gapNote(field) })),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the sample documents, with no assistant connected', () => {
  it('offers the text, Markdown and Word documents word for word, cited to the blocks they were read from', async () => {
    const { documents, search } = await shelve(ORG_A_TYPED);
    const outcome = await read({ documents, search });
    expectWordForWord(outcome, documents);
    expect(outcome.dropped).toBe(0);

    const [capacity] = outcome.claims.filter((claim) => claim.field === 'capacity');
    expect(capacity?.text).toBe(
      [
        'The organization employs 14 full-time and 6 part-time staff and is governed by an 11-member volunteer Board of Directors.',
        'The annual operating budget is approximately $1.8 million in fiscal year 2025.',
        'An independent financial audit is completed every year; the fiscal year 2024 audit had no findings.',
      ].join('\n'),
    );
    expect(capacity?.citations.map((citation) => [citation.documentName, citation.blockId, citation.section, citation.page])).toEqual([
      ['organizational-profile.docx', 'b0005', 'Harbor Lantern Collective Organizational Profile › Capacity', null],
      ['organizational-profile.docx', 'b0006', 'Harbor Lantern Collective Organizational Profile › Capacity', null],
      ['organizational-profile.docx', 'b0007', 'Harbor Lantern Collective Organizational Profile › Capacity', null],
    ]);

    // A figure spelled out in the document stays spelled out.
    expect(textsOf(outcome, 'impact_evidence')[0]).toMatch(
      /^In 2024, 312 adults completed a workforce certificate through the Pathways Workforce Academy\.\nSixty-eight percent of graduates were employed/,
    );
    expect(textsOf(outcome, 'programs')).toEqual(
      expect.arrayContaining([
        'Twelve-week certificate courses in logistics, food safety and bookkeeping, taught in English, Spanish and Portuguese. Each cohort ends with a hiring event run with the Eastside Employers Roundtable.',
        'One-on-one coaching for neighborhood entrepreneurs, including help with licensing, bookkeeping and referrals to microloans.',
      ]),
    );
    expect(textsOf(outcome, 'funding_goals')[0]).toBe(
      'We request $150,000 to expand the Pathways Workforce Academy from two to four cohorts a year.',
    );
  });

  it('offers two documents that give different founding years side by side, with no conflict', async () => {
    const { documents, search } = await shelve(ORG_A_TYPED);
    const outcome = await read({ documents, search });
    const all = outcome.claims.map((claim) => claim.text).join('\n');
    expect(all).toContain('It was founded in 2011 by residents of the Ironbound neighborhood.');
    expect(all).toContain('Since opening our doors in 2009, Harbor Lantern Collective has walked alongside thousands of our neighbors.');
    expect(outcome.conflicts).toEqual([]);
  });

  it('says what it found nothing for, rather than guessing', async () => {
    // None of these four documents states a mission or sets out priorities.
    const { documents, search } = await shelve(ORG_A_TYPED);
    const outcome = await read({ documents, search });
    expect(outcome.gaps).toEqual(
      expect.arrayContaining([
        { field: 'mission', note: 'No passage about the mission stood out in your documents.' },
        { field: 'strategic_priorities', note: 'No passage about strategic priorities stood out in your documents.' },
      ]),
    );
    expect(textsOf(outcome, 'mission')).toEqual([]);
  });

  it('offers both sides of a disagreement and does not judge between them', async () => {
    const { documents, search } = await shelve(ORG_A_ALL);
    const outcome = await read({ documents, search });
    expectWordForWord(outcome, documents);
    const all = outcome.claims.map((claim) => claim.text).join('\n');

    // The service area, a priority and the funding goal each differ between documents.
    expect(all).toContain("Our service area is Newark's East Ward and the Ironbound neighborhood in Essex County, New Jersey.");
    expect(all).toContain('Harbor Lantern Collective serves residents across all five wards of Newark.');
    expect(all).toContain('Priority 2. Open a shared-use incubator kitchen for food entrepreneurs by 2027.');
    expect(all).toContain('Priority 2. Launch a digital skills lab with 40 workstations by 2027.');
    expect(textsOf(outcome, 'funding_goals')).toEqual(
      expect.arrayContaining([
        'Raise $1.2 million in new multi-year grants between 2025 and 2028, including at least $400,000 for the incubator kitchen.',
        'Raise $1.5 million in new multi-year grants between 2026 and 2028, including at least $450,000 for the digital skills lab.',
      ]),
    );
    expect(outcome.conflicts).toEqual([]);
  });

  it('cites a PDF by page and section, and offers words two documents share only once', async () => {
    const { documents, search } = await shelve(ORG_A_ALL);
    const outcome = await read({ documents, search });
    const mission =
      "Harbor Lantern Collective strengthens economic mobility for working families in Newark's East Ward through adult education, workforce training and small-business coaching.";

    // Both strategic plans state the mission in the same words.
    expect(documents.filter((document) => document.blocks.some((block) => block.text === mission))).toHaveLength(2);
    expect(outcome.claims.filter((claim) => claim.text === mission)).toHaveLength(1);
    expect(textsOf(outcome, 'mission')).toEqual([mission]);
    const [claim] = outcome.claims.filter((entry) => entry.text === mission);
    expect(claim?.citations).toEqual([
      expect.objectContaining({
        blockId: 'b0004',
        page: 1,
        section: expect.stringMatching(/^Harbor Lantern Collective Strategic Plan .* › Our Mission$/),
        quote: mission,
        match: 'exact',
      }),
    ]);
    expect(textsOf(outcome, 'populations_served')[0]).toBe(
      'We serve adults aged 18 to 64 with household incomes below 200 percent of the federal poverty level, with a focus on recent immigrants, returning citizens and single parents.',
    );
  });

  it("reads a business's documents the same way", async () => {
    const { documents, search } = await shelve(ORG_B);
    const outcome = await read({ documents, search, organization: { name: 'Copperline Fabrication Works LLC', kind: 'business' } });
    expectWordForWord(outcome, documents);
    expect(textsOf(outcome, 'funding_goals')[0]).toMatch(
      /^We are seeking \$350,000 for equipment electrification and \$120,000 for apprenticeship wages\./,
    );
    expect(textsOf(outcome, 'strategic_priorities')[0]).toBe(
      'Replace two gas-fired furnaces with electric induction units by the end of 2027.\nTrain eight apprentices over two years in partnership with a local trade school.',
    );
    expect(outcome.gaps.map((gap) => gap.field)).toEqual(expect.arrayContaining(['populations_served', 'impact_evidence']));
  });

  it('uses no network', async () => {
    const fetched = vi.fn(() => {
      throw new Error('the network was used');
    });
    vi.stubGlobal('fetch', fetched);
    const { documents, search } = await shelve(ORG_A_TYPED);
    const outcome = await read({ documents, search });
    expect(outcome.claims.length).toBeGreaterThan(0);
    expect(fetched).not.toHaveBeenCalled();
  });
});

// ───────────────────────────── hand-made documents ─────────────────────────────

function block(id: string, text: string, kind: BlockKind = 'paragraph', section = '', page: number | null = null): ExtractedBlock {
  return { id, kind, text, page, section, headingLevel: kind === 'heading' ? 2 : null };
}

function document(id: string, blocks: ExtractedBlock[], version = 1): SourceDocument {
  return { id, name: `${id}.docx`, version, label: 'Other document', blocks };
}

function passage(source: SourceDocument, blockIds: string[], score: number, over: Partial<KnowledgePassage> = {}): KnowledgePassage {
  const blocks = source.blocks.filter((entry) => blockIds.includes(entry.id));
  return {
    documentId: source.id,
    documentName: source.name,
    documentVersion: source.version,
    category: 'other',
    blockIds,
    page: blocks[0]?.page ?? null,
    section: blocks.find((entry) => entry.kind !== 'heading')?.section ?? '',
    text: blocks.map((entry) => entry.text).join('\n'),
    score,
    ...over,
  };
}

/** A search that answers each field's query with prepared passages, and records what it was asked. */
function scriptedSearch(results: Partial<Record<ProfileFieldId, KnowledgePassage[]>>) {
  const asked: { field: ProfileFieldId | undefined; query: string; limit: number }[] = [];
  const search: PassageSearch = async (query, limit) => {
    const field = PROFILE_FIELDS.find((id) => PROFILE_FIELD_QUERIES[id].join(' ') === query);
    asked.push({ field, query, limit });
    return field ? (results[field] ?? []) : [];
  };
  return { search, asked };
}

const MISSION = 'Riverbend Works exists to open good jobs to young people leaving foster care in the river counties.';
const STAFF = 'Riverbend Works employs 12 full-time staff and is governed by a nine-member Board of Directors.';
const SERVED = 'We serve young people aged 16 to 24 who are leaving foster care.';

describe('choosing what to offer', () => {
  it('asks the search once for each field, with that field’s phrases', async () => {
    const source = document('about', [block('b0001', MISSION)]);
    const { search, asked } = scriptedSearch({ mission: [passage(source, ['b0001'], 4)] });
    await read({ documents: [source], search });
    expect(asked.map((entry) => entry.field)).toEqual([...PROFILE_FIELDS]);
    for (const entry of asked) {
      expect(entry.query).toBe(PROFILE_FIELD_QUERIES[entry.field ?? 'mission'].join(' '));
      expect(entry.limit).toBeGreaterThanOrEqual(MAX_OFFERED_PER_FIELD);
    }
  });

  it('takes the words from the documents handed in, never from the search result', async () => {
    const source = document('about', [block('b0001', 'Our Mission', 'heading'), block('b0002', MISSION, 'paragraph', 'Our Mission', 3)]);
    const altered = passage(source, ['b0001', 'b0002'], 4, {
      text: 'Our Mission\nRiverbend Works exists to open excellent jobs to 5,000 young people.',
      page: 9,
      section: 'Somewhere else',
    });
    const outcome = await read({ documents: [source], ...scriptedSearch({ mission: [altered] }) });
    expect(outcome.claims).toEqual([
      {
        field: 'mission',
        text: MISSION,
        origin: 'verbatim',
        supersedesClaimId: null,
        citations: [
          { documentId: 'about', documentName: 'about.docx', documentVersion: 1, blockId: 'b0002', page: 3, section: 'Our Mission', quote: MISSION, match: 'exact' },
        ],
      },
    ]);
  });

  it('leaves out, and counts, a passage that is not in the documents handed in', async () => {
    const current = document('about', [block('b0001', MISSION)], 2);
    const replaced = document('about', [block('b0001', 'Riverbend Works exists to serve everyone in the state.')], 1);
    const elsewhere = document('gone', [block('b0001', STAFF)]);
    const stale = [
      passage(replaced, ['b0001'], 9),
      passage(elsewhere, ['b0001'], 8),
      passage(current, ['b0044'], 7),
    ];
    // The same stale passages come back for two fields, and are counted once each.
    const outcome = await read({ documents: [current], ...scriptedSearch({ mission: stale, capacity: stale }) });
    expect(outcome.claims).toEqual([]);
    expect(outcome.dropped).toBe(3);
    expect(outcome.gaps).toHaveLength(PROFILE_FIELDS.length);
  });

  it('never returns a claim without a citation', async () => {
    const source = document('about', [
      block('b0001', 'Mission', 'heading'),
      block('b0002', 'Who we serve', 'heading'),
      block('b0003', 'Yes.', 'paragraph'),
      block('b0004', MISSION),
    ]);
    const outcome = await read({
      documents: [source],
      ...scriptedSearch({ mission: [passage(source, ['b0001', 'b0002'], 9), passage(source, [], 8)] }),
    });
    // Headings alone say nothing, and a passage naming no block has nothing to cite.
    expect(outcome.claims).toEqual([]);
    expect(outcome.dropped).toBe(0);
    expect(outcome.gaps.find((gap) => gap.field === 'mission')?.note).toBe(gapNote('mission'));
  });

  it('offers a passage under the field it matches best, and under no other', async () => {
    const source = document('about', [block('b0001', STAFF), block('b0002', MISSION), block('b0003', SERVED)]);
    const staff = (score: number) => passage(source, ['b0001'], score);
    const outcome = await read({
      documents: [source],
      ...scriptedSearch({
        // The staffing sentence leads both lists, but matches far more of what "capacity" looks for.
        mission: [staff(3), passage(source, ['b0002'], 2)],
        capacity: [staff(30)],
        populations_served: [passage(source, ['b0003'], 5)],
      }),
    });
    expect(textsOf(outcome, 'capacity')).toEqual([STAFF]);
    expect(textsOf(outcome, 'mission')).toEqual([MISSION]);
    expect(textsOf(outcome, 'populations_served')).toEqual([SERVED]);
    expect(outcome.claims.filter((claim) => claim.text === STAFF)).toHaveLength(1);
  });

  it('gives every field its best passage before any field its second, when scores cannot tell', async () => {
    const source = document('about', [block('b0001', MISSION), block('b0002', STAFF), block('b0003', SERVED)]);
    const unscored = (blockId: string) => passage(source, [blockId], 0);
    const outcome = await read({
      documents: [source],
      ...scriptedSearch({
        mission: [unscored('b0001'), unscored('b0002'), unscored('b0003')],
        capacity: [unscored('b0002')],
        populations_served: [unscored('b0003')],
      }),
    });
    expect(textsOf(outcome, 'mission')).toEqual([MISSION]);
    expect(textsOf(outcome, 'capacity')).toEqual([STAFF]);
    expect(textsOf(outcome, 'populations_served')).toEqual([SERVED]);
  });

  it('offers at most three passages for a field, best first', async () => {
    const sentences = [1, 2, 3, 4, 5].map((n) => `Program number ${n} teaches bookkeeping to adults in the river counties.`);
    const source = document('programs', sentences.map((text, index) => block(`b000${index + 1}`, text)));
    const found = sentences.map((_text, index) => passage(source, [`b000${index + 1}`], 10 - index));
    const outcome = await read({ documents: [source], ...scriptedSearch({ programs: found }) });
    expect(textsOf(outcome, 'programs')).toEqual(sentences.slice(0, 3));
  });

  it('offers the same words once when two documents hold them', async () => {
    const plan = document('plan', [block('b0001', MISSION)]);
    const refresh = document('refresh', [block('b0001', MISSION), block('b0002', SERVED)]);
    const outcome = await read({
      documents: [plan, refresh],
      ...scriptedSearch({
        mission: [passage(plan, ['b0001'], 6), passage(refresh, ['b0001'], 6)],
        // Nor do they reappear under another field.
        populations_served: [passage(refresh, ['b0001'], 3), passage(refresh, ['b0002'], 2)],
      }),
    });
    expect(outcome.claims.map((claim) => [claim.field, claim.text, claim.citations[0]?.documentId])).toEqual([
      ['mission', MISSION, 'plan'],
      ['populations_served', SERVED, 'refresh'],
    ]);
  });
});

describe('whole sentences', () => {
  const first = 'Riverbend Works was founded in 2014 by three former foster parents in Marlow County.';
  const second = 'It moved to its present workshop on Quay Street in 2019, at 4:30 p.m. on the day the lease began.';
  const third = 'Today it trains 60 apprentices a year with the U.S. Department of Labor as a registered sponsor.';
  const long = `${first} ${second} ${third} ${'Each cohort spends twelve weeks in the workshop and twelve weeks with an employer. '.repeat(6).trim()}`;

  it('keeps the opening sentences that fit and never cuts one', () => {
    expect(long.length).toBeGreaterThan(400);
    const kept = leadingSentences(long, 400);
    expect(long.startsWith(kept)).toBe(true);
    expect(kept.length).toBeLessThanOrEqual(400);
    expect(kept.startsWith(`${first} ${second} ${third}`)).toBe(true);
    expect(kept.endsWith('with an employer.')).toBe(true);
    // The next sentence would not have fitted.
    expect(kept.length + ' Each cohort spends twelve weeks in the workshop and twelve weeks with an employer.'.length).toBeGreaterThan(400);
    expect(leadingSentences(long, 100)).toBe(first);
    expect(leadingSentences(long, 40)).toBe('');
    expect(leadingSentences(first, 400)).toBe(first);
  });

  it('does not take an abbreviation, a time or a numbered label for the end of a sentence', () => {
    // "p.m." and "U.S." are followed by a capital letter without ending anything.
    expect(leadingSentences(`${second} ${third} ${first}`, second.length + 20)).toBe(second);
    expect(leadingSentences(`${third} ${first} ${second}`, third.length + 20)).toBe(third);
    const numbered = 'Priority 1. Expand bilingual workforce training to 500 learners a year by 2028. Priority 2. Open a kitchen.';
    expect(leadingSentences(numbered, 90)).toBe('Priority 1. Expand bilingual workforce training to 500 learners a year by 2028.');
    expect(leadingSentences(numbered, 30)).toBe('');
    const titled = 'Dr. Amara Okafor of Riverbend Works Inc. leads the program. She joined in 2016.';
    expect(leadingSentences(titled, 70)).toBe('Dr. Amara Okafor of Riverbend Works Inc. leads the program.');
  });

  it('offers a long block up to about 400 characters, ending on a sentence', async () => {
    const source = document('history', [block('b0001', long)]);
    const outcome = await read({ documents: [source], ...scriptedSearch({ strengths: [passage(source, ['b0001'], 5)] }) });
    const [claim] = outcome.claims;
    expect(claim?.text).toBe(leadingSentences(long, 400));
    expect(claim?.citations).toEqual([expect.objectContaining({ blockId: 'b0001', quote: claim?.text, match: 'exact' })]);
  });

  it('fills a passage block by block and stops at the block that does not fit whole', async () => {
    const source = document('report', [
      block('b0001', 'Results', 'heading'),
      block('b0002', first, 'paragraph', 'Results'),
      block('b0003', long, 'paragraph', 'Results'),
      block('b0004', SERVED, 'paragraph', 'Results'),
    ]);
    const outcome = await read({
      documents: [source],
      ...scriptedSearch({ impact_evidence: [passage(source, ['b0001', 'b0002', 'b0003', 'b0004'], 5)] }),
    });
    const [claim] = outcome.claims;
    // The second block is cut at a sentence, so the third is not reached: the passage has no hole in it.
    expect(claim?.citations.map((citation) => citation.blockId)).toEqual(['b0002', 'b0003']);
    expect(claim?.text).toBe(`${first}\n${leadingSentences(long, 400 - first.length - 1)}`);
    expect(claim?.text.length).toBeLessThanOrEqual(400);
    expect(claim?.text).not.toContain(SERVED);
  });

  it('offers one sentence a little over the limit whole, and a much longer one not at all', async () => {
    const clause = 'training in welding, machining, bookkeeping, logistics and food safety for adults across the river counties';
    const over = `Riverbend Works offers ${Array.from({ length: 4 }, () => clause).join(', and ')}.`;
    const far = `Riverbend Works offers ${Array.from({ length: 7 }, () => clause).join(', and ')}.`;
    expect(over.length).toBeGreaterThan(400);
    expect(over.length).toBeLessThanOrEqual(480);
    expect(far.length).toBeGreaterThan(600);
    const source = document('programs', [block('b0001', over), block('b0002', far)]);
    const outcome = await read({
      documents: [source],
      ...scriptedSearch({ programs: [passage(source, ['b0001'], 6), passage(source, ['b0002'], 5)] }),
    });
    expect(textsOf(outcome, 'programs')).toEqual([over]);
  });

  it('offers a table row or a short line only when it is a whole block', async () => {
    const source = document('data', [
      block('b0001', 'Employees | 22', 'table_row'),
      block('b0002', 'Facility | 18,000 square feet in Marlow County', 'table_row'),
    ]);
    const outcome = await read({ documents: [source], ...scriptedSearch({ capacity: [passage(source, ['b0001', 'b0002'], 5)] }) });
    expect(outcome.claims[0]?.text).toBe('Employees | 22\nFacility | 18,000 square feet in Marlow County');
    expect(outcome.claims[0]?.citations.map((citation) => citation.quote)).toEqual([
      'Employees | 22',
      'Facility | 18,000 square feet in Marlow County',
    ]);
  });
});

describe('stopping and reporting', () => {
  const source = document('about', [block('b0001', MISSION)]);

  it('stops between fields when the person cancels', async () => {
    const controller = new AbortController();
    const { search, asked } = scriptedSearch({ mission: [passage(source, ['b0001'], 4)] });
    const stopping: PassageSearch = async (query, limit) => {
      const found = await search(query, limit);
      if (asked.length === 3) controller.abort();
      return found;
    };
    await expect(read({ documents: [source], search: stopping, signal: controller.signal })).rejects.toMatchObject({
      name: 'FundingError',
      code: 'CANCELLED',
      message: 'Cancelled.',
    });
    expect(asked).toHaveLength(3);
  });

  it('reports a search that fails after a cancel as cancelled', async () => {
    const controller = new AbortController();
    const failing: PassageSearch = async () => {
      controller.abort();
      throw new Error('the index was closed');
    };
    await expect(offerPassages({ documents: [source], search: failing, signal: controller.signal, progress: () => {} })).rejects.toMatchObject({
      code: 'CANCELLED',
    });
  });

  it('reports progress as a percentage that only goes up', async () => {
    const seen: [string, number | null | undefined][] = [];
    await read({
      documents: [source],
      ...scriptedSearch({ mission: [passage(source, ['b0001'], 4)] }),
      progress: (message, percent) => seen.push([message, percent]),
    });
    const percents = seen.map(([, percent]) => percent);
    expect(percents.length).toBeGreaterThan(PROFILE_FIELDS.length);
    for (const [index, percent] of percents.entries()) {
      expect(typeof percent).toBe('number');
      expect(percent).toBeGreaterThanOrEqual(index === 0 ? 0 : (percents[index - 1] ?? 0));
      expect(percent).toBeLessThanOrEqual(100);
    }
    for (const [message] of seen) expect(message).toMatch(/^[A-Z][^.!]*$/);
  });
});

describe('the app’s own words for a gap', () => {
  it('has a plain sentence for every field that claims no more than the search can know', () => {
    const notes = PROFILE_FIELDS.map((field) => gapNote(field));
    expect(new Set(notes).size).toBe(PROFILE_FIELDS.length);
    for (const note of notes) {
      expect(note).toMatch(/^No passage about [a-z ,]+ stood out in your documents\.$/);
      expect(note).not.toMatch(/!|assistant|model|\bAI\b/i);
    }
  });
});
