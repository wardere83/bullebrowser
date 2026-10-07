import { describe, expect, it } from 'vitest';
import type { SetupStatus } from '../../../shared/funding.js';
import { ICON_NAMES } from '../ui/icons.js';
import { badge } from '../ui/styles.js';
import { APPROVE_BEFORE_TAILORED_GUIDANCE, setupFacts } from './setup-facts.js';

function counts(patch: Partial<SetupStatus['counts']> = {}): SetupStatus['counts'] {
  return {
    documents: 0,
    documentsReady: 0,
    documentsFailed: 0,
    claimsProposed: 0,
    claimsApproved: 0,
    claimsNeedingReview: 0,
    openConflicts: 0,
    ...patch,
  };
}

const labels = (patch: Partial<SetupStatus['counts']>) =>
  setupFacts(counts(patch)).map((fact) => fact.label);

describe('setupFacts', () => {
  it('says plainly when there is nothing yet', () => {
    expect(labels({})).toEqual(['No documents yet', 'No statements approved yet']);
  });

  it('counts documents and how many are ready', () => {
    expect(labels({ documents: 1, documentsReady: 1 })).toEqual([
      '1 document',
      '1 of 1 ready',
      'No statements approved yet',
    ]);
    expect(labels({ documents: 4, documentsReady: 3 }).slice(0, 2)).toEqual([
      '4 documents',
      '3 of 4 ready',
    ]);
  });

  it('lists a failure, proposals, statements to review and conflicts only when there are some', () => {
    expect(
      labels({
        documents: 4,
        documentsReady: 3,
        documentsFailed: 1,
        claimsApproved: 6,
        claimsProposed: 3,
        claimsNeedingReview: 1,
        openConflicts: 2,
      }),
    ).toEqual([
      '4 documents',
      '3 of 4 ready',
      '1 failed',
      '6 statements approved',
      '3 proposed',
      '1 needs review',
      '2 conflicts between documents',
    ]);
    expect(labels({ documents: 2, documentsReady: 2, claimsApproved: 1, claimsNeedingReview: 2 })).toEqual([
      '2 documents',
      '2 of 2 ready',
      '1 statement approved',
      '2 need review',
    ]);
  });

  it('gives every count a tone and an icon the kit has, so none relies on colour', () => {
    const facts = setupFacts(
      counts({
        documents: 4,
        documentsReady: 3,
        documentsFailed: 1,
        claimsApproved: 6,
        claimsProposed: 3,
        claimsNeedingReview: 1,
        openConflicts: 2,
      }),
    );
    for (const fact of facts) {
      expect(Object.keys(badge.tone), fact.id).toContain(fact.tone);
      expect(ICON_NAMES, fact.id).toContain(fact.icon);
      expect(fact.label.trim(), fact.id).not.toBe('');
    }
    expect(new Set(facts.map((fact) => fact.id)).size).toBe(facts.length);
  });

  it('marks what calls for attention', () => {
    const facts = setupFacts(
      counts({ documents: 2, documentsReady: 1, documentsFailed: 1, claimsNeedingReview: 1, openConflicts: 1 }),
    );
    const tone = (id: string) => facts.find((fact) => fact.id === id)?.tone;
    expect(tone('failed')).toBe('danger');
    expect(tone('review')).toBe('caution');
    expect(tone('conflicts')).toBe('caution');
    expect(tone('ready')).toBe('info');
    expect(tone('approved')).toBe('neutral');
  });

  it('keeps the numbers whole and within bounds whatever arrives', () => {
    expect(labels({ documents: 2.9, documentsReady: 7, claimsApproved: -3, claimsProposed: Number.NaN })).toEqual([
      '2 documents',
      '2 of 2 ready',
      'No statements approved yet',
    ]);
  });
});

describe('the invitation to approve a profile', () => {
  it('invites without forbidding anything', () => {
    expect(APPROVE_BEFORE_TAILORED_GUIDANCE).toContain(
      'Complete and approve your profile before asking for tailored guidance.',
    );
    expect(APPROVE_BEFORE_TAILORED_GUIDANCE).not.toMatch(/must|cannot|required/i);
  });
});
