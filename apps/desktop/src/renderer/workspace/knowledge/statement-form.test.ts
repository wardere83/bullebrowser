import { describe, expect, it } from 'vitest';
import type { KnowledgePassage } from '../../../shared/funding.js';
import { passageKey } from './passages.js';
import {
  NO_PICKS,
  STATEMENT_MISSING,
  buildClaimInput,
  canCite,
  checkStatement,
  leftOutNote,
  partOf,
  quoteOf,
  sameWording,
  toEvidence,
  togglePick,
  withPart,
} from './statement-form.js';

function passage(patch: Partial<KnowledgePassage> = {}): KnowledgePassage {
  return {
    documentId: 'doc-1',
    documentName: 'Annual report.pdf',
    documentVersion: 1,
    category: 'impact_report',
    blockIds: ['b4', 'b5'],
    page: 3,
    section: '',
    text: 'In 2025 the pantry served 1,250 residents. It cost $48,000 to run.',
    score: 1,
    ...patch,
  };
}

/** The part a selection of `fragment` stands for, as text. */
function selected(text: string, fragment: string): string | null {
  const start = text.indexOf(fragment);
  if (start < 0) throw new Error(`"${fragment}" is not in the passage`);
  const part = partOf(text, start, start + fragment.length);
  return part ? text.slice(part.start, part.end) : null;
}

describe('partOf', () => {
  const text = passage().text;

  it('is the selected words', () => {
    expect(selected(text, 'the pantry served 1,250 residents')).toBe(
      'the pantry served 1,250 residents',
    );
  });

  it('leaves out white space at either end of the selection', () => {
    expect(selected(text, ' the pantry served ')).toBe('the pantry served');
  });

  it('widens to whole words, never cutting one in two', () => {
    expect(selected(text, 'antry serv')).toBe('pantry served');
    expect(selected(text, 'resid')).toBe('residents');
  });

  it('never cuts a number in two', () => {
    expect(selected(text, '250 residents')).toBe('1,250 residents');
    expect(selected(text, '1,2')).toBe('1,250');
    expect(selected('The rate rose to 4.5 percent.', '.5 per')).toBe('4.5 percent');
  });

  it('keeps an amount with its currency sign', () => {
    expect(selected(text, '48,000 to run')).toBe('$48,000 to run');
    expect(selected(text, '000')).toBe('$48,000');
  });

  it('keeps a word with its apostrophe', () => {
    expect(selected('It is the organization’s plan.', 'zation')).toBe('organization’s');
  });

  it('does not reach past the end of a sentence', () => {
    expect(selected(text, 'residents')).toBe('residents');
    expect(selected(text, 'run')).toBe('run');
  });

  it('is nothing when nothing is selected', () => {
    expect(partOf(text, 5, 5)).toBeNull();
    expect(partOf('a   b', 1, 4)).toBeNull();
  });

  it('is nothing when the whole passage is selected, with or without the space around it', () => {
    expect(partOf(text, 0, text.length)).toBeNull();
    const padded = `  ${text}\n`;
    expect(partOf(padded, 0, padded.length)).toBeNull();
    expect(partOf(padded, 2, padded.length - 1)).toBeNull();
  });

  it('accepts a selection made backwards or reaching outside the text', () => {
    expect(partOf(text, 14, 8)).toEqual(partOf(text, 8, 14));
    expect(partOf(text, -20, 7)).toEqual({ start: 0, end: 7 });
    expect(partOf(text, Number.NaN, 7)).toEqual({ start: 0, end: 7 });
  });

  it('always gives offsets of a stretch that is in the passage', () => {
    for (let start = 0; start < text.length; start += 3) {
      for (let end = start + 1; end <= text.length; end += 5) {
        const part = partOf(text, start, end);
        if (!part) continue;
        expect(part.start).toBeGreaterThanOrEqual(0);
        expect(part.end).toBeLessThanOrEqual(text.length);
        expect(part.end).toBeGreaterThan(part.start);
        expect(part.start).toBeLessThanOrEqual(start + (end - start));
        expect(text.slice(part.start, part.end)).toBe(text.slice(part.start, part.end).trim());
      }
    }
  });
});

describe('picking evidence', () => {
  it('starts with the whole passage', () => {
    const first = passage();
    const picks = togglePick(NO_PICKS, first, true);
    expect(picks.size).toBe(1);
    expect(picks.get(passageKey(first))).toEqual({ passage: first, part: null });
    expect(quoteOf({ passage: first, part: null })).toBe(first.text);
  });

  it('keeps the order passages were picked in, and lets one be put back', () => {
    const first = passage();
    const second = passage({ documentId: 'doc-2', blockIds: ['b1'] });
    let picks = togglePick(NO_PICKS, second, true);
    picks = togglePick(picks, first, true);
    expect([...picks.values()].map((pick) => pick.passage.documentId)).toEqual(['doc-2', 'doc-1']);
    picks = togglePick(picks, second, false);
    expect([...picks.keys()]).toEqual([passageKey(first)]);
  });

  it('returns the same picks when nothing changes', () => {
    const first = passage();
    const picks = togglePick(NO_PICKS, first, true);
    expect(togglePick(picks, first, true)).toBe(picks);
    expect(togglePick(NO_PICKS, first, false)).toBe(NO_PICKS);
    expect(withPart(picks, 'not-picked', { start: 0, end: 2 })).toBe(picks);
  });

  it('narrows a passage to a part and widens it again', () => {
    const first = passage();
    const key = passageKey(first);
    const part = partOf(first.text, first.text.indexOf('It cost'), first.text.length - 1);
    let picks = withPart(togglePick(NO_PICKS, first, true), key, part);
    const narrowed = picks.get(key);
    expect(narrowed && quoteOf(narrowed)).toBe('It cost $48,000 to run');
    picks = withPart(picks, key, null);
    const widened = picks.get(key);
    expect(widened && quoteOf(widened)).toBe(first.text);
  });

  it('only ever quotes text that is in the passage', () => {
    const first = passage();
    for (const fragment of ['served 1,250', 'pantry', '2025 the', 'cost $48,000']) {
      const start = first.text.indexOf(fragment);
      const quote = quoteOf({ passage: first, part: partOf(first.text, start, start + fragment.length) });
      expect(first.text.includes(quote)).toBe(true);
    }
  });

  it('cannot cite a passage that has no text or no block to point at', () => {
    expect(canCite(passage())).toBe(true);
    expect(canCite(passage({ blockIds: [] }))).toBe(false);
    expect(canCite(passage({ text: '   ' }))).toBe(false);
  });
});

describe('toEvidence', () => {
  it('sends the document, the passage’s first block and the words to cite', () => {
    const first = passage();
    const second = passage({ documentId: 'doc-2', blockIds: ['b9'], text: 'Our mission is food for all.' });
    const key = passageKey(second);
    let picks = togglePick(togglePick(NO_PICKS, first, true), second, true);
    picks = withPart(picks, key, partOf(second.text, 0, 'Our mission'.length));
    expect(toEvidence(picks.values())).toEqual([
      { documentId: 'doc-1', blockId: 'b4', quote: first.text },
      { documentId: 'doc-2', blockId: 'b9', quote: 'Our mission' },
    ]);
  });

  it('leaves out a passage with no block', () => {
    const picks = togglePick(NO_PICKS, passage({ blockIds: [] }), true);
    expect(toEvidence(picks.values())).toEqual([]);
  });

  it('is empty when nothing was picked', () => {
    expect(toEvidence(NO_PICKS.values())).toEqual([]);
  });
});

describe('the wording', () => {
  it('must not be empty', () => {
    expect(checkStatement('')).toEqual({ ok: false, error: STATEMENT_MISSING });
    expect(checkStatement(' \n ')).toEqual({ ok: false, error: STATEMENT_MISSING });
  });

  it('is saved as written, without the space around it', () => {
    expect(checkStatement('  We feed our neighbors.\nEvery week.  ')).toEqual({
      ok: true,
      text: 'We feed our neighbors.\nEvery week.',
    });
  });

  it('becomes the input main expects', () => {
    const first = passage();
    const built = buildClaimInput(
      'impact_evidence',
      ' The pantry served 1,250 residents in 2025. ',
      togglePick(NO_PICKS, first, true).values(),
    );
    expect(built).toEqual({
      ok: true,
      input: {
        field: 'impact_evidence',
        text: 'The pantry served 1,250 residents in 2025.',
        evidence: [{ documentId: 'doc-1', blockId: 'b4', quote: first.text }],
      },
    });
  });

  it('can be saved without evidence', () => {
    expect(buildClaimInput('mission', 'We feed our neighbors.', NO_PICKS.values())).toEqual({
      ok: true,
      input: { field: 'mission', text: 'We feed our neighbors.', evidence: [] },
    });
  });

  it('is not sent when empty', () => {
    expect(buildClaimInput('mission', '  ', NO_PICKS.values())).toEqual({
      ok: false,
      error: STATEMENT_MISSING,
    });
  });

  it('counts as unchanged when only the space around it differs', () => {
    expect(sameWording('We feed our neighbors.', ' We feed our neighbors.\n')).toBe(true);
    expect(sameWording('We feed our neighbors.', 'We feed our neighbours.')).toBe(false);
  });
});

describe('leftOutNote', () => {
  it('says nothing when every picked passage is cited', () => {
    expect(leftOutNote(0, 0)).toBe('');
    expect(leftOutNote(2, 2)).toBe('');
    expect(leftOutNote(2, 3)).toBe('');
  });

  it('counts the passages that were left out, without guessing which', () => {
    expect(leftOutNote(3, 1)).toBe(
      'Only 1 of the 3 passages you picked is cited. A passage that cannot be matched to its document is left out.',
    );
    expect(leftOutNote(3, 2)).toContain('Only 2 of the 3 passages you picked are cited.');
  });

  it('says so when none is cited', () => {
    expect(leftOutNote(1, 0)).toContain('The passage you picked is not cited.');
    expect(leftOutNote(2, 0)).toContain('None of the 2 passages you picked is cited.');
  });
});
