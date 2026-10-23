import { describe, expect, it } from 'vitest';
import type { OrganizationProfile, ProfileClaim, SetupStatus } from '../../../shared/funding.js';
import {
  KNOWLEDGE_TABS,
  countsFromData,
  countsFromSetup,
  defaultTab,
  isKnowledgeTab,
  openingTab,
  readRequest,
} from './tabs.js';

function setup(counts: Partial<SetupStatus['counts']>): Pick<SetupStatus, 'counts'> {
  return {
    counts: {
      documents: 0,
      documentsReady: 0,
      documentsFailed: 0,
      claimsProposed: 0,
      claimsApproved: 0,
      claimsNeedingReview: 0,
      openConflicts: 0,
      ...counts,
    },
  };
}

function claim(id: string, status: ProfileClaim['status']): ProfileClaim {
  return {
    id,
    field: 'mission',
    text: 'A statement.',
    origin: 'user',
    status,
    citations: [],
    reviewReason: null,
    reviewNote: '',
    supersedesClaimId: null,
    edited: false,
    createdAt: 1,
    updatedAt: 1,
    approvedAt: null,
    approvedBy: null,
  };
}

describe('the tabs', () => {
  it('are named and ordered as the product owner asked', () => {
    expect(KNOWLEDGE_TABS.map((tab) => tab.label)).toEqual([
      'Documents',
      'Profile',
      'Our Priorities',
      'Search',
    ]);
    expect(KNOWLEDGE_TABS.map((tab) => tab.id)).toEqual([
      'documents',
      'profile',
      'priorities',
      'search',
    ]);
  });

  it('are the only values accepted as a tab', () => {
    expect(isKnowledgeTab('priorities')).toBe(true);
    expect(isKnowledgeTab('Profile')).toBe(false);
    expect(isKnowledgeTab(undefined)).toBe(false);
    expect(isKnowledgeTab(2)).toBe(false);
  });
});

describe('readRequest', () => {
  it('asks for nothing when the screen is opened without parameters', () => {
    expect(readRequest({})).toEqual({ tab: null, field: null, documentId: null });
  });

  it('takes the tab that was asked for', () => {
    expect(readRequest({ tab: 'search' }).tab).toBe('search');
    expect(readRequest({ tab: 'priorities' }).tab).toBe('priorities');
  });

  it('opens the profile at a field', () => {
    expect(readRequest({ tab: 'profile', field: 'funding_goals' })).toEqual({
      tab: 'profile',
      field: 'funding_goals',
      documentId: null,
    });
    // A field on its own can only mean the profile.
    expect(readRequest({ field: 'mission' })).toMatchObject({ tab: 'profile', field: 'mission' });
  });

  it('opens the documents at a document', () => {
    expect(readRequest({ documentId: 'doc-7' })).toEqual({
      tab: 'documents',
      field: null,
      documentId: 'doc-7',
    });
    expect(readRequest({ tab: 'documents', documentId: 'doc-7' }).documentId).toBe('doc-7');
  });

  it('drops a field or a document that does not belong to the tab', () => {
    expect(readRequest({ tab: 'search', field: 'mission', documentId: 'doc-7' })).toEqual({
      tab: 'search',
      field: null,
      documentId: null,
    });
    expect(readRequest({ tab: 'profile', documentId: 'doc-7' }).documentId).toBeNull();
    expect(readRequest({ tab: 'documents', field: 'mission' }).field).toBeNull();
  });

  it('ignores what is not a tab, a field or a document id', () => {
    const odd = { tab: 'settings', field: 'budget', documentId: '  ' } as unknown as Parameters<
      typeof readRequest
    >[0];
    expect(readRequest(odd)).toEqual({ tab: null, field: null, documentId: null });
  });
});

describe('the tab a visit opens on', () => {
  it('is the documents while there are none', () => {
    expect(defaultTab({ documents: 0, awaitingReview: 0 })).toBe('documents');
    // Statements written by hand can wait for review before any document exists.
    expect(defaultTab({ documents: 0, awaitingReview: 3 })).toBe('documents');
  });

  it('is the profile when something there awaits a decision', () => {
    expect(defaultTab({ documents: 2, awaitingReview: 1 })).toBe('profile');
  });

  it('is the documents when nothing is waiting', () => {
    expect(defaultTab({ documents: 2, awaitingReview: 0 })).toBe('documents');
  });

  it('counts proposals, statements to review and open conflicts as waiting', () => {
    expect(countsFromSetup(setup({ documents: 4, claimsProposed: 2 }))).toEqual({
      documents: 4,
      awaitingReview: 2,
    });
    expect(
      countsFromSetup(setup({ documents: 4, claimsNeedingReview: 1, openConflicts: 1 }))
        .awaitingReview,
    ).toBe(2);
    // Approved statements wait for nobody.
    expect(countsFromSetup(setup({ documents: 4, claimsApproved: 9 })).awaitingReview).toBe(0);
  });

  it('reads the same counts from the screen’s own data', () => {
    const profile: Pick<OrganizationProfile, 'claims' | 'conflicts'> = {
      claims: [
        claim('a', 'approved'),
        claim('b', 'proposed'),
        claim('c', 'needs_review'),
        claim('d', 'rejected'),
      ],
      conflicts: [
        { id: 'x', field: 'mission', summary: '', claimIds: ['a', 'b'], resolvedAt: null },
        { id: 'y', field: 'mission', summary: '', claimIds: ['a', 'd'], resolvedAt: 5 },
      ],
    };
    expect(countsFromData([{ id: 'doc-1' }, { id: 'doc-2' }], profile)).toEqual({
      documents: 2,
      awaitingReview: 3,
    });
    expect(countsFromData([], { claims: [], conflicts: [] })).toEqual({
      documents: 0,
      awaitingReview: 0,
    });
  });

  it('is not decided until the counts are known, and falls back to the documents', () => {
    expect(openingTab(null, false)).toBeNull();
    expect(openingTab(null, true)).toBe('documents');
    expect(openingTab({ documents: 1, awaitingReview: 1 }, false)).toBe('profile');
  });
});
