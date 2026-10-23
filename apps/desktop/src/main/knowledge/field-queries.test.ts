import { describe, expect, it } from 'vitest';
import { PROFILE_FIELDS, type ProfileFieldId } from '../../shared/funding.js';
import type { BlockKind, ExtractedBlock } from '../documents/types.js';
import { PROFILE_FIELD_QUERIES } from './field-queries.js';
import { buildPassages } from './passages.js';
import { SearchIndex } from './search-index.js';
import { tokenize } from './text.js';

type Line = [kind: BlockKind, text: string, section?: string];

/** One document's passages, built the way the app builds them. */
function indexOf(documents: { id: string; name: string; lines: Line[] }[]): SearchIndex {
  const index = new SearchIndex();
  for (const document of documents) {
    const blocks: ExtractedBlock[] = document.lines.map(([kind, text, section], position) => ({
      id: `b${String(position + 1).padStart(4, '0')}`,
      kind,
      text,
      page: null,
      section: section ?? '',
      headingLevel: kind === 'heading' ? 2 : null,
    }));
    index.add({
      documentId: document.id,
      documentName: document.name,
      documentVersion: 1,
      category: 'other',
      passages: buildPassages(document.id, blocks),
    });
  }
  return index;
}

const best = (index: SearchIndex, field: ProfileFieldId) => index.search(PROFILE_FIELD_QUERIES[field].join(' '))[0]?.text ?? '';

describe('PROFILE_FIELD_QUERIES', () => {
  it('has phrases for every profile field and no others', () => {
    expect(Object.keys(PROFILE_FIELD_QUERIES).sort()).toEqual([...PROFILE_FIELDS].sort());
    for (const field of PROFILE_FIELDS) {
      const phrases = PROFILE_FIELD_QUERIES[field];
      expect(phrases.length).toBeGreaterThanOrEqual(3);
      expect(new Set(phrases).size).toBe(phrases.length);
      for (const phrase of phrases) {
        expect(phrase).toBe(phrase.trim().toLowerCase());
        // Every phrase searches for something: none is only function words.
        expect(tokenize(phrase).length).toBeGreaterThan(0);
      }
    }
  });

  // What a CBO's documents say, each statement under the heading it was found under.
  const underHeadings: Record<ProfileFieldId, Line[]> = {
    mission: [
      ['heading', 'Our Mission'],
      ['paragraph', "Harbor Lantern Collective strengthens economic mobility for working families in Newark's East Ward through adult education, workforce training and small-business coaching.", 'Our Mission'],
    ],
    populations_served: [
      ['heading', 'Populations Served', 'Who We Serve'],
      ['paragraph', 'We serve adults aged 18 to 64 with household incomes below 200 percent of the federal poverty level, with a focus on recent immigrants, returning citizens and single parents.', 'Who We Serve › Populations Served'],
    ],
    geographic_scope: [
      ['heading', 'Geographic Scope', 'Who We Serve'],
      ['paragraph', "Our service area is Newark's East Ward and the Ironbound neighborhood in Essex County, New Jersey.", 'Who We Serve › Geographic Scope'],
    ],
    strategic_priorities: [
      ['heading', 'Strategic Priorities 2025-2028'],
      ['paragraph', 'The Board adopted four strategic priorities for this period.', 'Strategic Priorities 2025-2028'],
      ['list_item', 'Priority 1. Expand bilingual workforce training to 500 learners a year by 2028.', 'Strategic Priorities 2025-2028'],
      ['list_item', 'Priority 2. Open a shared-use incubator kitchen for food entrepreneurs by 2027.', 'Strategic Priorities 2025-2028'],
    ],
    programs: [
      ['heading', 'Pathways Workforce Academy', 'Program Descriptions'],
      ['paragraph', 'Twelve-week certificate courses in logistics, food safety and bookkeeping, taught in English, Spanish and Portuguese. Each cohort ends with a hiring event run with the Eastside Employers Roundtable.', 'Program Descriptions › Pathways Workforce Academy'],
    ],
    strengths: [
      ['heading', 'Demonstrated Strengths'],
      ['paragraph', 'Eleven of our 14 full-time staff speak Spanish or Portuguese, so every program is delivered bilingually.', 'Demonstrated Strengths'],
      ['paragraph', 'Our instructors hold industry certifications in logistics, food safety and bookkeeping.', 'Demonstrated Strengths'],
    ],
    impact_evidence: [
      ['paragraph', 'In 2024, 312 adults completed a workforce certificate through the Pathways Workforce Academy.'],
      ['paragraph', 'Sixty-eight percent of graduates were employed within six months of completing their certificate.'],
      ['paragraph', 'Graduates who were already working reported an average hourly wage increase of $4.10.'],
    ],
    capacity: [
      ['heading', 'Capacity'],
      ['paragraph', 'The organization employs 14 full-time and 6 part-time staff and is governed by an 11-member volunteer Board of Directors.', 'Capacity'],
      ['paragraph', 'The annual operating budget is approximately $1.8 million in fiscal year 2025.', 'Capacity'],
    ],
    funding_goals: [
      ['heading', 'Funding Goals', 'Resourcing the Plan'],
      ['paragraph', 'Raise $1.2 million in new multi-year grants between 2025 and 2028, including at least $400,000 for the incubator kitchen.', 'Resourcing the Plan › Funding Goals'],
    ],
  };

  it.each(PROFILE_FIELDS)('ranks the passage for "%s" first among statements under headings', (field) => {
    // Each field is its own document, so nothing but the words decides the ranking.
    const index = indexOf(PROFILE_FIELDS.map((id) => ({ id, name: 'document.pdf', lines: underHeadings[id] })));
    const expected = underHeadings[field].map(([, text]) => text).join('\n');
    expect(best(index, field)).toBe(expected);
  });

  // The same kinds of statement in running text, with no headings to go by.
  const inProse: Record<ProfileFieldId, string> = {
    mission: 'Our mission is to strengthen economic mobility for working families through adult education and small-business coaching.',
    populations_served: 'We serve adults aged 18 to 64 with household incomes below 200 percent of the federal poverty level, with a focus on recent immigrants, returning citizens and single parents.',
    geographic_scope: "Our service area is Newark's East Ward and the Ironbound neighborhood in Essex County, New Jersey.",
    strategic_priorities: 'The Board adopted four strategic priorities for 2025 to 2028, beginning with bilingual instruction for 500 learners a year.',
    programs: 'Pathways Workforce Academy offers twelve-week certificate courses in logistics, food safety and bookkeeping, taught in English, Spanish and Portuguese.',
    strengths: 'Our instructors hold industry certifications, and we have a ten-year track record of managing government grants.',
    impact_evidence: 'In 2024, 312 adults completed a certificate, and sixty-eight percent of graduates were employed within six months.',
    capacity: 'The organization employs 14 full-time and 6 part-time staff and is governed by an 11-member volunteer Board of Directors.',
    funding_goals: 'We are seeking $350,000 for equipment electrification and $120,000 for apprenticeship wages.',
  };

  it.each(PROFILE_FIELDS)('ranks the sentence for "%s" first in running text', (field) => {
    // Every sentence is a passage of its own in one document.
    const index = new SearchIndex();
    index.add({
      documentId: 'prose',
      documentName: 'about-us.txt',
      documentVersion: 1,
      category: 'other',
      passages: PROFILE_FIELDS.map((id, position) => ({
        id: `prose:b${position + 1}`,
        documentId: 'prose',
        blockIds: [`b${position + 1}`],
        page: null,
        section: '',
        text: inProse[id],
      })),
    });
    expect(best(index, field)).toBe(inProse[field]);
  });

  it('finds a business’s statements as well as a CBO’s', () => {
    const index = indexOf([
      {
        id: 'business',
        name: 'business-profile.txt',
        lines: [
          ['paragraph', 'Copperline Fabrication Works LLC is a 22-employee metal fabrication shop in the Boyle Heights neighborhood of Los Angeles, California.'],
          ['paragraph', 'We manufacture the Zephyrquill hinge series and custom steel railings for regional transit agencies and school districts.'],
          ['heading', 'INVESTMENT PRIORITIES'],
          ['paragraph', 'Replace two gas-fired furnaces with electric induction units by the end of 2027.', 'INVESTMENT PRIORITIES'],
          ['heading', 'FUNDING GOALS'],
          ['paragraph', 'We are seeking $350,000 for equipment electrification and $120,000 for apprenticeship wages.', 'FUNDING GOALS'],
        ],
      },
    ]);
    expect(best(index, 'funding_goals')).toMatch(/We are seeking \$350,000/);
    expect(best(index, 'strategic_priorities')).toMatch(/Replace two gas-fired furnaces/);
    expect(best(index, 'programs')).toMatch(/We manufacture the Zephyrquill hinge series/);
    expect(best(index, 'geographic_scope')).toMatch(/Boyle Heights neighborhood of Los Angeles/);
  });

  it('offers nothing for a field the documents do not speak to', () => {
    const index = indexOf([{ id: 'budget', name: 'table.txt', lines: [['table_row', 'Personnel | $1,263,000'], ['table_row', 'Occupancy | $168,000']] }]);
    for (const field of PROFILE_FIELDS) expect(index.search(PROFILE_FIELD_QUERIES[field].join(' '))).toEqual([]);
  });
});
