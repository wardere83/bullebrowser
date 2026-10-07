import { describe, expect, it } from 'vitest';
import { PROFILE_FIELDS } from '../../shared/funding.js';
import {
  PROFILE_ANSWER_LIMITS,
  PROFILE_RELATIONS,
  checkProfileAnswer,
  profileAnswerSchema,
  type ProfileAnswer,
  type ProfileStatement,
} from './profile-extraction-schema.js';

const APPROVED = new Set(['A1:b0001', 'A1:b0002']);
const schema = profileAnswerSchema((id) => APPROVED.has(id));

const MISSION = 'Riverbend Works exists to open good jobs to young people leaving foster care.';

function statement(over: Partial<ProfileStatement> = {}): ProfileStatement {
  return {
    position: 0,
    field: 'mission',
    text: 'Riverbend Works opens good jobs to young people leaving foster care.',
    evidence: [{ block_id: 'D1:b0004', quote: MISSION }],
    relation: 'new',
    related_id: '',
    ...over,
  };
}

function answer(over: Partial<ProfileAnswer> = {}): ProfileAnswer {
  return {
    statements: [statement(), statement({ position: 1, field: 'capacity', text: 'It employs 12 full-time staff.' })],
    conflicts: [{ field: 'capacity', summary: 'Two documents give different staff counts.', statements: [0, 1] }],
    gaps: [{ field: 'funding_goals', note: 'The documents do not state what the organization wants funded.' }],
    ...over,
  };
}

type Node = Record<string, unknown>;

/** Every schema object inside a schema, the schema itself included. */
function nodesOf(node: unknown): Node[] {
  if (!node || typeof node !== 'object' || Array.isArray(node)) return [];
  const here = node as Node;
  const inner = [here.items, ...Object.values((here.properties as Node | undefined) ?? {})];
  return [here, ...inner.flatMap((entry) => nodesOf(entry))];
}

describe('the schema sent to the assistant', () => {
  const nodes = nodesOf(schema.json);

  it('has a name both providers accept', () => {
    expect(schema.name).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
  });

  it('closes every object and requires every property', () => {
    const objects = nodes.filter((node) => node.type === 'object');
    expect(objects).toHaveLength(5);
    for (const node of objects) {
      expect(node.additionalProperties).toBe(false);
      expect(node.required).toEqual(Object.keys(node.properties as Node));
    }
  });

  it('uses nothing the wire cannot enforce: no unions, no nullable types, no lengths or ranges', () => {
    const refused = ['anyOf', 'oneOf', 'allOf', 'not', 'nullable', '$ref', 'minLength', 'maxLength', 'minimum', 'maximum', 'minItems', 'maxItems', 'pattern', 'format', 'default'];
    for (const node of nodes) {
      expect(typeof node.type).toBe('string');
      for (const key of refused) expect(node, key).not.toHaveProperty(key);
    }
  });

  it('names the nine fields and the four relations, and nothing about any organization', () => {
    const enums = nodes.filter((node) => Array.isArray(node.enum)).map((node) => node.enum);
    expect(enums).toEqual([[...PROFILE_FIELDS], [...PROFILE_RELATIONS], [...PROFILE_FIELDS], [...PROFILE_FIELDS]]);
    // The same object whatever the request, so the provider's copy of it holds no one's data.
    expect(profileAnswerSchema(() => true).json).toBe(schema.json);
    expect(JSON.stringify(schema.json)).not.toMatch(/A1:b0001|Riverbend/);
  });

  it('describes exactly the properties the app reads', () => {
    const properties = (node: unknown) => Object.keys(((node as Node).properties as Node | undefined) ?? {});
    const top = (schema.json.properties ?? {}) as Record<string, Node>;
    expect(properties(schema.json)).toEqual(['statements', 'conflicts', 'gaps']);
    expect(properties(top.statements?.items)).toEqual(['position', 'field', 'text', 'evidence', 'relation', 'related_id']);
    expect(properties(((top.statements?.items as Node).properties as Record<string, Node>).evidence?.items)).toEqual(['block_id', 'quote']);
    expect(properties(top.conflicts?.items)).toEqual(['field', 'summary', 'statements']);
    expect(properties(top.gaps?.items)).toEqual(['field', 'note']);
    // What the wire accepts, the second check accepts.
    expect(schema.zod.safeParse(answer()).success).toBe(true);
  });
});

describe('the limits the wire cannot carry', () => {
  const parses = (value: unknown) => schema.zod.safeParse(value).success;

  it('accepts a complete answer and an empty one', () => {
    expect(schema.zod.parse(answer())).toEqual(answer());
    expect(parses({ statements: [], conflicts: [], gaps: [] })).toBe(true);
  });

  it('trims what it is given', () => {
    const parsed = schema.zod.parse(answer({ statements: [statement({ text: '  It employs 12 staff.\n', related_id: ' ' })] , conflicts: [] }));
    expect(parsed.statements[0]).toMatchObject({ text: 'It employs 12 staff.', related_id: '' });
  });

  it.each([
    ['a statement with no evidence', answer({ statements: [statement({ evidence: [] })], conflicts: [] })],
    ['a statement with no text', answer({ statements: [statement({ text: '   ' })], conflicts: [] })],
    ['an empty quotation', answer({ statements: [statement({ evidence: [{ block_id: 'D1:b0004', quote: '' }] })], conflicts: [] })],
    ['a statement far longer than one fact', answer({ statements: [statement({ text: 'word '.repeat(200) })], conflicts: [] })],
    ['more evidence than a statement can need', answer({ statements: [statement({ evidence: Array.from({ length: PROFILE_ANSWER_LIMITS.evidencePerStatement + 1 }, () => ({ block_id: 'D1:b0004', quote: MISSION })) })], conflicts: [] })],
    ['a field that is not one of the nine', answer({ statements: [{ ...statement(), field: 'vision' } as unknown as ProfileStatement], conflicts: [] })],
    ['a relation that is not one of the four', answer({ statements: [{ ...statement(), relation: 'replaces' } as unknown as ProfileStatement], conflicts: [] })],
    ['a position that is not a whole number', answer({ statements: [statement({ position: 1.5 })], conflicts: [] })],
    ['a negative position', answer({ statements: [statement({ position: -1 })], conflicts: [] })],
    ['a conflict that names no statement', answer({ conflicts: [{ field: 'capacity', summary: 'They differ.', statements: [] }] })],
    ['a conflict with no summary', answer({ conflicts: [{ field: 'capacity', summary: '', statements: [0, 1] }] })],
    ['a gap with no note', answer({ gaps: [{ field: 'mission', note: ' ' }] })],
    ['a property the app did not ask for', { ...answer(), verdict: 'approved' }],
    ['a statement with a property the app did not ask for', answer({ statements: [{ ...statement(), confidence: 0.9 } as unknown as ProfileStatement], conflicts: [] })],
    ['an answer with a part missing', { statements: [], conflicts: [] }],
    ['more statements than an answer may hold', answer({ statements: Array.from({ length: PROFILE_ANSWER_LIMITS.statements + 1 }, (_, position) => statement({ position: position % PROFILE_ANSWER_LIMITS.statements })), conflicts: [] })],
  ])('refuses %s', (_label, value) => {
    expect(parses(value)).toBe(false);
  });
});

describe('the rules that need the request to judge', () => {
  const check = (value: ProfileAnswer) => schema.check?.(value) ?? ['no check'];

  it('passes an answer that keeps them', () => {
    expect(check(answer())).toEqual([]);
    expect(
      check(
        answer({
          statements: [
            statement({ relation: 'same_as', related_id: 'A1:b0001' }),
            statement({ position: 1, relation: 'updates', related_id: 'A1:b0002' }),
            statement({ position: 2, relation: 'conflicts_with', related_id: 'A1:b0002' }),
          ],
        }),
      ),
    ).toEqual([]);
  });

  it('wants the id of an approved statement that was shown, for every relation but "new"', () => {
    const problems = check(
      answer({
        statements: [
          statement({ relation: 'updates', related_id: '' }),
          statement({ position: 1, relation: 'same_as', related_id: 'A1:b0099' }),
          statement({ position: 2, relation: 'conflicts_with', related_id: 'D1:b0004' }),
          statement({ position: 3, relation: 'new', related_id: 'A1:b0001' }),
        ],
        conflicts: [],
      }),
    );
    expect(problems).toEqual([
      'statements.0.related_id: the relation "updates" needs the id of an approved statement.',
      'statements.1.related_id: this is not the id of an approved statement.',
      'statements.2.related_id: this is not the id of an approved statement.',
      'statements.3.related_id: leave this empty when the relation is "new".',
    ]);
  });

  it('refuses every relation but "new" when nothing has been approved', () => {
    const none = profileAnswerSchema(() => false);
    expect(none.check?.(answer({ statements: [statement({ relation: 'same_as', related_id: 'A1:b0001' })], conflicts: [] }))).toEqual([
      'statements.0.related_id: this is not the id of an approved statement.',
    ]);
    expect(none.check?.(answer())).toEqual([]);
  });

  it('wants every statement to have a position of its own, and every conflict to name positions that exist', () => {
    const problems = check(
      answer({
        statements: [statement({ position: 0 }), statement({ position: 0 }), statement({ position: 2 })],
        conflicts: [
          { field: 'mission', summary: 'They differ.', statements: [0, 2] },
          { field: 'mission', summary: 'They differ.', statements: [2, 7] },
        ],
      }),
    );
    expect(problems).toEqual([
      'statements.1.position: 0 is already the position of another statement.',
      'conflicts.1.statements.1: no statement has position 7.',
    ]);
  });

  it('accepts positions that start at 1, since a conflict only has to name them', () => {
    expect(
      check(
        answer({
          statements: [statement({ position: 1 }), statement({ position: 2 })],
          conflicts: [{ field: 'mission', summary: 'They differ.', statements: [1, 2] }],
        }),
      ),
    ).toEqual([]);
  });

  it('puts the path first and repeats nothing a document said', () => {
    const quote = 'A sentence copied from a document, which the correction must not carry back.';
    const problems = checkProfileAnswer(
      answer({
        statements: [statement({ relation: 'updates', related_id: '', evidence: [{ block_id: 'D1:b0004', quote }] })],
        conflicts: [{ field: 'mission', summary: quote, statements: [5] }],
      }),
      () => false,
    );
    expect(problems).toHaveLength(2);
    for (const problem of problems) {
      expect(problem).toMatch(/^(?:statements|conflicts)\.\d+\.[a-z_]+(?:\.\d+)?: /);
      expect(problem).not.toContain(quote);
    }
  });

  it('leaves evidence alone: whether a quotation is in the documents is decided afterwards, never by correction', () => {
    expect(check(answer({ statements: [statement({ evidence: [{ block_id: 'Z9:b9999', quote: 'Words found in no document.' }] })], conflicts: [] }))).toEqual([]);
  });
});
