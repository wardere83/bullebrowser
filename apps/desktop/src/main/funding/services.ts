// What the parts of the funding platform promise each other. Types only.
//
// The parts are of two kinds. A store keeps one organization's material on
// disk and is always asked by organization id. A pipeline is a function: it is
// handed documents and an optional assistant, and returns a result without
// reading or writing anything itself. platform.ts joins them, and handlers.ts
// is the only code that decides which organization a call is about.

import type {
  AlignmentReport,
  AnalysisStatus,
  Citation,
  GuideFeedback,
  GuideSession,
  KnowledgeCategory,
  KnowledgeDocument,
  KnowledgePassage,
  NewClaimInput,
  OpportunityDetail,
  OpportunityFilters,
  Organization,
  OrganizationKind,
  OrganizationProfile,
  OrgLocation,
  ProfileClaim,
  ProfileFieldId,
  ProfileGap,
  RfpAnalysis,
  RfpDocument,
  SetupStatus,
} from '../../shared/funding.js';
import type { ProfileTerm } from '../opportunities/match.js';
import type { Complete, Progress, SourceDocument } from './pipeline.js';

/** Who is acting, as the door resolved it. Never taken from the renderer. */
export interface Actor {
  userId: string;
  /** Whether this person may approve profile statements in the organization. */
  canApprove: boolean;
}

/** Finds passages in one organization's own documents. */
export type PassageSearch = (query: string, limit: number) => Promise<KnowledgePassage[]>;

/**
 * The confirmed profile, as the guidance features may use it. It holds
 * approved statements only: nothing proposed, rejected or awaiting review.
 */
export interface ApprovedBaseline {
  organizationId: string;
  organization: { name: string; kind: OrganizationKind; location: OrgLocation };
  claims: ProfileClaim[];
  /** When a person last approved statements; null when none is approved. */
  approvedAt: number | null;
}

// ───────────────────────────── reading a profile ──────────────────────────────

/** A statement the documents support, offered for a person to confirm. */
export interface ProposedClaim {
  field: ProfileFieldId;
  text: string;
  origin: 'extracted' | 'verbatim';
  /** Never empty: a statement without evidence in the documents is not proposed. */
  citations: Citation[];
  /** The approved statement this would replace if a person accepts it. */
  supersedesClaimId: string | null;
}

/** Documents that disagree. At least two sides, counting both lists. */
export interface ProposedConflict {
  field: ProfileFieldId;
  summary: string;
  /** Positions in `claims` of the proposed statements that disagree. */
  claimIndexes: number[];
  /** Approved statements the proposals disagree with. */
  existingClaimIds: string[];
}

export interface ExtractionOutcome {
  method: 'assistant' | 'verbatim';
  claims: ProposedClaim[];
  conflicts: ProposedConflict[];
  /** Fields the documents do not cover. */
  gaps: ProfileGap[];
  /** Statements left out because their evidence was not found in the documents. */
  dropped: number;
}

export interface ExtractionInput {
  organization: { name: string; kind: OrganizationKind };
  /** Every document that has been read, with its text. */
  documents: SourceDocument[];
  /** What is already confirmed, so new findings can be related to it. */
  approved: Pick<ProfileClaim, 'id' | 'field' | 'text'>[];
  /** Null when no assistant is connected: passages are then offered word for word. */
  complete: Complete | null;
  search: PassageSearch;
  signal: AbortSignal;
  progress: Progress;
}

export type ExtractProfile = (input: ExtractionInput) => Promise<ExtractionOutcome>;

// ─────────────────────────────── knowledge hub ────────────────────────────────

export interface KnowledgeHubApi {
  listDocuments(organizationId: string): Promise<KnowledgeDocument[]>;
  /** Files already chosen by the user in a system dialog. Unreadable ones are reported per document. */
  addDocuments(
    organizationId: string,
    input: { paths: string[]; category?: KnowledgeCategory; userId: string },
  ): Promise<KnowledgeDocument[]>;
  replaceDocument(organizationId: string, documentId: string, sourcePath: string): Promise<KnowledgeDocument>;
  setCategory(organizationId: string, documentId: string, category: KnowledgeCategory): Promise<KnowledgeDocument>;
  retryDocument(organizationId: string, documentId: string): Promise<KnowledgeDocument>;
  deleteDocument(organizationId: string, documentId: string): Promise<void>;

  search(organizationId: string, query: string, limit?: number): Promise<KnowledgePassage[]>;
  suggestPassages(organizationId: string, field: ProfileFieldId): Promise<KnowledgePassage[]>;
  /** The documents that have been read, as a pipeline sees them. */
  sourceDocuments(organizationId: string): Promise<SourceDocument[]>;

  getProfile(organizationId: string): Promise<OrganizationProfile>;
  setupStatus(organization: Organization): Promise<SetupStatus>;
  /** Marks a reading as under way. */
  beginExtraction(organizationId: string): Promise<void>;
  /** Stores what a reading found as proposals. Never changes an approved statement. */
  applyExtraction(organizationId: string, outcome: ExtractionOutcome): Promise<OrganizationProfile>;
  /** Ends a reading that did not finish. An empty message means it was stopped, not that it failed. */
  endExtraction(organizationId: string, message: string): Promise<void>;

  approveClaims(organizationId: string, claimIds: string[], actor: Actor): Promise<OrganizationProfile>;
  rejectClaims(organizationId: string, claimIds: string[], actor: Actor): Promise<OrganizationProfile>;
  addClaim(organizationId: string, input: NewClaimInput, actor: Actor): Promise<OrganizationProfile>;
  updateClaim(organizationId: string, claimId: string, text: string, actor: Actor): Promise<OrganizationProfile>;
  deleteClaim(organizationId: string, claimId: string, actor: Actor): Promise<OrganizationProfile>;
  resolveConflict(
    organizationId: string,
    conflictId: string,
    keepClaimIds: string[],
    actor: Actor,
  ): Promise<OrganizationProfile>;

  baseline(organization: Organization): Promise<ApprovedBaseline>;
  /** Words and phrases from approved statements, for ranking listings on the device. */
  profileTerms(organizationId: string): Promise<ProfileTerm[]>;
  suggestFilters(organization: Organization): Promise<{ filters: OpportunityFilters; basis: string[] }>;

  /** Resolves once no document of the organization is waiting to be read. */
  whenIdle(organizationId: string): Promise<void>;
  /** Drops what is held in memory for an organization, after it has been deleted. */
  forget(organizationId: string): void;
}

// ─────────────────────────────── funding documents ────────────────────────────

export interface RfpStoreApi {
  list(organizationId: string): Promise<RfpDocument[]>;
  get(organizationId: string, rfpId: string): Promise<RfpDocument | null>;
  addFiles(organizationId: string, input: { paths: string[]; userId: string }): Promise<RfpDocument[]>;
  /** Shelves an official listing's own text as a funding document. */
  addListing(organizationId: string, input: { detail: OpportunityDetail; userId: string }): Promise<RfpDocument>;
  /** Removes the document with its analysis and its alignment report. */
  remove(organizationId: string, rfpId: string): Promise<void>;
  /** The document as a pipeline reads it. Refuses one that is missing, unread or failed. */
  source(organizationId: string, rfpId: string): Promise<SourceDocument>;

  analysis(organizationId: string, rfpId: string): Promise<RfpAnalysis | null>;
  saveAnalysis(organizationId: string, analysis: RfpAnalysis): Promise<void>;
  setAnalysisStatus(organizationId: string, rfpId: string, status: AnalysisStatus): Promise<void>;
  alignment(organizationId: string, rfpId: string): Promise<AlignmentReport | null>;
  saveAlignment(organizationId: string, report: AlignmentReport): Promise<void>;
  setAlignmentStatus(organizationId: string, rfpId: string, status: AnalysisStatus): Promise<void>;

  whenIdle(organizationId: string): Promise<void>;
}

export interface AnalyzeRfpInput {
  organizationId: string;
  document: SourceDocument;
  /** Null when no assistant is connected: the result then holds literal findings only. */
  complete: Complete | null;
  signal: AbortSignal;
  progress: Progress;
  now: number;
}

export type AnalyzeRfp = (input: AnalyzeRfpInput) => Promise<RfpAnalysis>;

// ───────────────────────────────── alignment ──────────────────────────────────

export interface AlignmentInput {
  organizationId: string;
  rfp: SourceDocument;
  analysis: RfpAnalysis;
  baseline: ApprovedBaseline;
  /** The organization's own documents, for evidence beyond the approved statements. */
  knowledge: SourceDocument[];
  search: PassageSearch;
  /** Null when no assistant is connected: requirements are then paired with passages, without findings. */
  complete: Complete | null;
  signal: AbortSignal;
  progress: Progress;
  now: number;
}

export type AssessAlignment = (input: AlignmentInput) => Promise<AlignmentReport>;

// ───────────────────────────────── proposal guide ─────────────────────────────

export interface GuideStoreApi {
  /** Newest first. */
  list(organizationId: string): Promise<GuideSession[]>;
  get(organizationId: string, guideId: string): Promise<GuideSession | null>;
  save(organizationId: string, guide: GuideSession): Promise<void>;
  remove(organizationId: string, guideId: string): Promise<void>;
  /** Removes the guides written for a funding document that is being removed. */
  removeForRfp(organizationId: string, rfpId: string): Promise<void>;
}

export interface GuideInput {
  /** The id the new guide will have. */
  id: string;
  organizationId: string;
  /** Null for a general guide grounded only in the profile. */
  rfp: SourceDocument | null;
  analysis: RfpAnalysis | null;
  baseline: ApprovedBaseline;
  knowledge: SourceDocument[];
  search: PassageSearch;
  /** Null when no assistant is connected: the guide is then the standard outline. */
  complete: Complete | null;
  signal: AbortSignal;
  progress: Progress;
  now: number;
}

export type BuildGuide = (input: GuideInput) => Promise<GuideSession>;

export interface FeedbackInput {
  /** The id the feedback will have. */
  id: string;
  guide: GuideSession;
  sectionId: string;
  /** The user's own words. Used for this request and never stored. */
  draft: string;
  rfp: SourceDocument | null;
  baseline: ApprovedBaseline;
  knowledge: SourceDocument[];
  search: PassageSearch;
  complete: Complete;
  signal: AbortSignal;
  progress: Progress;
  now: number;
}

export type ReviewDraft = (input: FeedbackInput) => Promise<GuideFeedback>;
