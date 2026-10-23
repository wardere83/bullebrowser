import { describe, expect, it } from 'vitest';
import type { KnowledgePassage } from '../../../shared/funding.js';
import {
  SEARCH_LIMIT,
  passageKey,
  passagePlace,
  searchAnnouncement,
  tidyQuery,
  uniquePassages,
} from './passages.js';

function passage(patch: Partial<KnowledgePassage> = {}): KnowledgePassage {
  return {
    documentId: 'doc-1',
    documentName: 'Strategic plan.pdf',
    documentVersion: 1,
    category: 'strategic_plan',
    blockIds: ['b1', 'b2'],
    page: 4,
    section: 'Goals › Youth',
    text: 'Expand the after-school program to two more schools.',
    score: 2,
    ...patch,
  };
}

describe('searching', () => {
  it('asks for ten passages', () => {
    expect(SEARCH_LIMIT).toBe(10);
  });

  it('tidies what was typed', () => {
    expect(tidyQuery('  youth   programs\n')).toBe('youth programs');
    expect(tidyQuery(' \t ')).toBe('');
  });

  it('reads out how many passages were found', () => {
    expect(searchAnnouncement(0)).toBe('No passages found.');
    expect(searchAnnouncement(1)).toBe('1 passage found.');
    expect(searchAnnouncement(10)).toBe('10 passages found.');
  });
});

describe('a passage', () => {
  it('is told apart by its document, version and blocks', () => {
    expect(passageKey(passage())).toBe('doc-1:1:b1+b2');
    expect(passageKey(passage({ documentVersion: 2 }))).not.toBe(passageKey(passage()));
    expect(passageKey(passage({ blockIds: ['b1'] }))).not.toBe(passageKey(passage()));
  });

  it('is listed once', () => {
    const listed = uniquePassages([
      passage({ score: 3 }),
      passage({ blockIds: ['b7'] }),
      passage({ score: 1 }),
    ]);
    expect(listed).toHaveLength(2);
    expect(listed[0]?.score).toBe(3);
    expect(listed[1]?.blockIds).toEqual(['b7']);
  });

  it('is placed by its page when it has one, and by its section otherwise', () => {
    expect(passagePlace(passage())).toBe('p. 4');
    expect(passagePlace(passage({ page: null }))).toBe('Goals › Youth');
    expect(passagePlace(passage({ page: null, section: '  ' }))).toBe('');
  });
});
