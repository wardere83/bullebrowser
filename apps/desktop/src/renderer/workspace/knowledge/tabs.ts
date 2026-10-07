// The four parts of the Organization Knowledge Hub: what each tab is called,
// what a visit asked to see, and which tab a visit opens on when it did not
// ask. Kept apart from the screen so the rules can be tested.

import {
  PROFILE_FIELDS,
  type KnowledgeDocument,
  type OrganizationProfile,
  type ProfileFieldId,
  type SetupStatus,
} from '../../../shared/funding.js';
import type { KnowledgeTab, WorkspaceParams } from '../../state/workspace-store.js';

/** In the order they are shown. "Our Priorities" is the product owner's wording. */
export const KNOWLEDGE_TABS: readonly { id: KnowledgeTab; label: string }[] = [
  { id: 'documents', label: 'Documents' },
  { id: 'profile', label: 'Profile' },
  { id: 'priorities', label: 'Our Priorities' },
  { id: 'search', label: 'Search' },
];

export function isKnowledgeTab(value: unknown): value is KnowledgeTab {
  return KNOWLEDGE_TABS.some((tab) => tab.id === value);
}

function isProfileField(value: unknown): value is ProfileFieldId {
  return (PROFILE_FIELDS as readonly unknown[]).includes(value);
}

/** What a visit asked to see. Every part is null when it asked for nothing in particular. */
export interface HubRequest {
  tab: KnowledgeTab | null;
  /** A profile field whose heading should take focus. Only with the profile tab. */
  field: ProfileFieldId | null;
  /** A document to point out in the list. Only with the documents tab. */
  documentId: string | null;
}

/**
 * Reads the route's parameters. They come from links elsewhere in the app, so
 * anything that is not a known tab or field is ignored rather than trusted. A
 * field on its own means the profile, and a document on its own means the
 * documents; a field or document that does not belong to the tab is dropped.
 */
export function readRequest(params: WorkspaceParams['knowledge']): HubRequest {
  const field = isProfileField(params.field) ? params.field : null;
  const documentId =
    typeof params.documentId === 'string' && params.documentId.trim() ? params.documentId : null;
  const tab: KnowledgeTab | null = isKnowledgeTab(params.tab)
    ? params.tab
    : field
      ? 'profile'
      : documentId
        ? 'documents'
        : null;
  return {
    tab,
    field: tab === 'profile' ? field : null,
    documentId: tab === 'documents' ? documentId : null,
  };
}

/** The two numbers the opening tab depends on. */
export interface HubCounts {
  documents: number;
  /** Proposed statements, statements whose source changed, and open conflicts. */
  awaitingReview: number;
}

export function countsFromSetup(setup: Pick<SetupStatus, 'counts'>): HubCounts {
  const { counts } = setup;
  return {
    documents: counts.documents,
    awaitingReview: counts.claimsProposed + counts.claimsNeedingReview + counts.openConflicts,
  };
}

/** The same numbers from the screen's own data, for when the setup status is not available. */
export function countsFromData(
  documents: readonly Pick<KnowledgeDocument, 'id'>[],
  profile: Pick<OrganizationProfile, 'claims' | 'conflicts'>,
): HubCounts {
  const waiting = profile.claims.filter(
    (claim) => claim.status === 'proposed' || claim.status === 'needs_review',
  ).length;
  const conflicts = profile.conflicts.filter((conflict) => conflict.resolvedAt === null).length;
  return { documents: documents.length, awaitingReview: waiting + conflicts };
}

/**
 * The tab a visit opens on when it did not ask for one: the documents while
 * there are none, and otherwise the profile when something there is waiting
 * for a person's decision.
 */
export function defaultTab(counts: HubCounts): KnowledgeTab {
  if (counts.documents <= 0) return 'documents';
  return counts.awaitingReview > 0 ? 'profile' : 'documents';
}

/**
 * The tab to open on, or null while that cannot be known yet. Once nothing more
 * can arrive (`settled`) the documents are shown, so a failed load never leaves
 * the screen without tabs.
 */
export function openingTab(counts: HubCounts | null, settled: boolean): KnowledgeTab | null {
  if (counts) return defaultTab(counts);
  return settled ? 'documents' : null;
}
