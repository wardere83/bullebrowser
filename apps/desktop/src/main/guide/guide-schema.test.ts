import { describe, expect, it } from 'vitest';
import { outlineSchema, STRENGTH_MAX_CHARACTERS, type OutlineReply } from './guide-schema.js';
import { STANDARD_SECTION_IDS } from './standard-outline.js';

interface Schema {
  type?: string;
  properties?: Record<string, Schema>;
  required?: string[];
  additionalProperties?: boolean;
  $defs?: Record<string, Schema>;
  $ref?: string;
  items?: Schema;
}

const wire = outlineSchema.json as Schema;
const definitions = wire.$defs!;

function nodes(node: Schema, references: string[] = []): Schema[] {
  if (node.$ref) {
    expect(node.$ref).toMatch(/^#\/\$defs\/[a-z_]+$/);
    expect(references).not.toContain(node.$ref);
    const target = definitions[node.$ref.slice('#/$defs/'.length)];
    expect(target).toBeDefined();
    return [node, ...nodes(target!, [...references, node.$ref])];
  }
  return [
    node,
    ...[
      ...Object.values(node.properties ?? {}),
      ...Object.values(node.$defs ?? {}),
      ...(node.items ? [node.items] : []),
    ].flatMap((child) => nodes(child, references)),
  ];
}

function answer(): OutlineReply {
  const evidence = [{ block_id: 'D1:b0001', quote: 'The CBO runs free community training.' }];
  return Object.fromEntries(
    STANDARD_SECTION_IDS.map((id) => [
      id,
      {
        heading: 'Documented community strengths',
        purpose: 'Show how documented strengths support this part of the proposal.',
        criteria: [{ requirement_id: 'R1:r0001', evidence }],
        strengths: [{ text: 'The CBO runs free community training.', evidence }],
        questions: [
          {
            text: 'Which documented result best supports this part?',
            why: 'Use evidence the reader can check.',
          },
        ],
        evidence_to_gather: ['Gather the program evaluation.'],
      },
    ]),
  ) as OutlineReply;
}

describe('the proposal guide schema sent to the service', () => {
  it('requires all eight standard parts and their complete outline contents', () => {
    expect(STANDARD_SECTION_IDS).toHaveLength(8);
    expect(Object.keys(wire.properties!)).toEqual([...STANDARD_SECTION_IDS]);
    expect(wire.required).toEqual([...STANDARD_SECTION_IDS]);
    for (const id of STANDARD_SECTION_IDS)
      expect(wire.properties![id]!.$ref).toBe('#/$defs/section');
    expect(definitions.section!.required).toEqual([
      'heading',
      'purpose',
      'criteria',
      'strengths',
      'questions',
      'evidence_to_gather',
    ]);
  });

  it('resolves acyclic local definitions and keeps cited strengths and every object closed', () => {
    for (const node of nodes(wire).filter((node) => node.type === 'object')) {
      expect(node.additionalProperties).toBe(false);
      expect(node.required).toEqual(Object.keys(node.properties!));
    }
    const section = definitions.section!.properties!;
    expect(section.strengths!.items!.$ref).toBe('#/$defs/statement');
    expect(definitions.statement!.required).toEqual(['text', 'evidence']);
    expect(definitions.statement!.properties!.text!.type).toBe('string');
    expect(definitions.statement!.properties!.evidence!.items!.$ref).toBe('#/$defs/evidence');
    expect(section.criteria!.items!.required).toEqual(['requirement_id', 'evidence']);
    expect(section.criteria!.items!.properties!.evidence!.items!.$ref).toBe('#/$defs/evidence');
    expect(definitions.evidence!.required).toEqual(['block_id', 'quote']);
    expect(Object.values(definitions.evidence!.properties!).map((node) => node.type)).toEqual([
      'string',
      'string',
    ]);
  });
});

describe('proposal guide validation on the device', () => {
  it('accepts a complete cited outline with reflective questions', () => {
    const complete = answer();
    expect(outlineSchema.zod.parse(complete)).toEqual(complete);
  });

  it('rejects an omitted standard part', () => {
    const { sustainability: _omitted, ...incomplete } = answer();
    expect(outlineSchema.zod.safeParse(incomplete).success).toBe(false);
  });

  it('rejects an overlong strength so the outline cannot become proposal prose', () => {
    const complete = answer();
    complete.strengths_track_record.strengths[0]!.text = 'x'.repeat(STRENGTH_MAX_CHARACTERS + 1);
    expect(outlineSchema.zod.safeParse(complete).success).toBe(false);
  });

  it('rejects a statement supplied in place of a reflective question', () => {
    const complete = answer();
    complete.community_context.questions[0]!.text =
      'Describe the community as a completed proposal paragraph.';
    expect(outlineSchema.zod.safeParse(complete).success).toBe(false);
  });
});
