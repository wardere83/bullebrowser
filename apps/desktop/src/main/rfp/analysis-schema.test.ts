import { describe, expect, it } from 'vitest';
import { RFP_SECTIONS, RFP_SECTION_LABELS } from '../../shared/funding.js';
import { RFP_ANALYSIS_SCHEMA, type RawRfpAnalysis } from './analysis-schema.js';

interface Schema {
  type?: string;
  properties?: Record<string, Schema>;
  required?: string[];
  additionalProperties?: boolean;
  $defs?: Record<string, Schema>;
  $ref?: string;
  description?: string;
  items?: Schema;
  enum?: string[];
}

const wire = RFP_ANALYSIS_SCHEMA.json as Schema;
const definitions = wire.$defs!;

/** Visit local references as the provider does, rejecting dangling or recursive ones. */
function nodes(node: Schema, references: string[] = []): Schema[] {
  if (node.$ref) {
    expect(node.$ref).toMatch(/^#\/\$defs\/[a-z_]+$/);
    expect(references).not.toContain(node.$ref);
    const target = definitions[node.$ref.slice('#/$defs/'.length)];
    expect(target).toBeDefined();
    return [node, ...nodes(target!, [...references, node.$ref])];
  }
  const children = [
    ...Object.values(node.properties ?? {}),
    ...Object.values(node.$defs ?? {}),
    ...(node.items ? [node.items] : []),
  ];
  return [node, ...children.flatMap((child) => nodes(child, references))];
}

function answer(): RawRfpAnalysis {
  const evidence = [{ block_id: 'F1:b0001', quote: 'Awards support free community training.' }];
  return {
    overview: 'The funder supports community training.',
    sections: Object.fromEntries(
      RFP_SECTIONS.map((id) => [
        id,
        {
          coverage: 'stated',
          note: '',
          items: [{ text: 'Awards support training.', basis: 'explicit', evidence }],
        },
      ]),
    ) as RawRfpAnalysis['sections'],
    glossary: [{ term: 'Award', plain_language: 'Funding for the proposed activity.', evidence }],
    ai_use: { stance: 'not_stated', summary: '', evidence: [] },
    uncertainties: [{ text: 'The application format is unclear.', evidence }],
    questions: [{ text: 'Which application format should applicants use?', evidence }],
  };
}

describe('the funding analysis schema sent to the service', () => {
  it('requires all thirteen topics with their labels and complete section contents', () => {
    const sections = wire.properties!.sections!;
    expect(RFP_SECTIONS).toHaveLength(13);
    expect(Object.keys(sections.properties!)).toEqual([...RFP_SECTIONS]);
    expect(sections.required).toEqual([...RFP_SECTIONS]);
    for (const id of RFP_SECTIONS) {
      const section = sections.properties![id]!;
      expect(section.description).toBe(RFP_SECTION_LABELS[id]);
      expect(section.$ref).toBe('#/$defs/section');
    }
    expect(Object.keys(definitions.section!.properties!)).toEqual(['coverage', 'note', 'items']);
  });

  it('reuses valid acyclic definitions and closes every object with all properties required', () => {
    expect(Object.keys(definitions)).toEqual(['evidence', 'item', 'section', 'note']);
    expect(definitions.section!.properties!.items!.items!.$ref).toBe('#/$defs/item');
    expect(definitions.item!.properties!.evidence!.items!.$ref).toBe('#/$defs/evidence');
    expect(wire.properties!.uncertainties!.items!.$ref).toBe('#/$defs/note');
    expect(wire.properties!.questions!.items!.$ref).toBe('#/$defs/note');
    for (const node of nodes(wire).filter((node) => node.type === 'object')) {
      expect(node.additionalProperties).toBe(false);
      expect(node.required).toEqual(Object.keys(node.properties!));
    }
    expect(definitions.evidence!.required).toEqual(['block_id', 'quote']);
    expect(definitions.item!.required).toEqual(['text', 'basis', 'evidence']);
    expect(definitions.note!.required).toEqual(['text', 'evidence']);
  });

  it('retains the exact coverage, evidence basis and AI policy choices', () => {
    expect(definitions.section!.properties!.coverage!.enum).toEqual([
      'stated',
      'unclear',
      'missing',
    ]);
    expect(definitions.item!.properties!.basis!.enum).toEqual(['explicit', 'interpretation']);
    expect(wire.properties!.ai_use!.properties!.stance!.enum).toEqual([
      'not_stated',
      'permitted',
      'permitted_with_disclosure',
      'restricted',
      'prohibited',
    ]);
  });
});

describe('funding analysis validation on the device', () => {
  it('accepts a complete report including citations, glossary and follow-up notes', () => {
    const complete = answer();
    expect(RFP_ANALYSIS_SCHEMA.zod.parse(complete)).toEqual(complete);
  });

  it('rejects an omitted topic instead of accepting an incomplete report', () => {
    const complete = answer();
    const { award_amounts: _omitted, ...sections } = complete.sections;
    expect(RFP_ANALYSIS_SCHEMA.zod.safeParse({ ...complete, sections }).success).toBe(false);
  });

  it('rejects invalid coverage, evidence basis and AI policy values', () => {
    const complete = answer();
    const section = complete.sections.award_amounts;
    for (const invalid of [
      {
        ...complete,
        sections: { ...complete.sections, award_amounts: { ...section, coverage: 'unknown' } },
      },
      {
        ...complete,
        sections: {
          ...complete.sections,
          award_amounts: { ...section, items: [{ ...section.items[0], basis: 'guessed' }] },
        },
      },
      { ...complete, ai_use: { ...complete.ai_use, stance: 'unknown' } },
    ])
      expect(RFP_ANALYSIS_SCHEMA.zod.safeParse(invalid).success).toBe(false);
  });
});
