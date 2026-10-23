// Domain contract for the funding platform: organizations, the Organization
// Knowledge Hub, funding opportunities, RFP analysis and the proposal guide.
//
// Types and plain constants only. This file is compiled into main, preload and
// renderer, so it must not import anything that belongs to one process.
//
// Three rules shape everything below:
//  1. Every record that holds organization material carries its organizationId,
//     and nothing is ever looked up across organizations.
//  2. A citation is built by the app from text it extracted itself. Text written
//     by a model never appears as a quotation.
//  3. A funding listing is "active" only when an official source said so in this
//     session and its deadline has not passed. Anything else is labelled.

// ───────────────────────────── results across IPC ─────────────────────────────

export type FundingErrorCode =
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'ORGANIZATION_NOT_FOUND'
  | 'MEMBERSHIP_NOT_FOUND'
  | 'INVALID_SESSION'
  | 'PROVIDER_UNAVAILABLE'
  | 'MIGRATION_FAILED'
  | 'NOT_FOUND'
  | 'INVALID_INPUT'
  | 'UNSUPPORTED_FILE'
  | 'FILE_TOO_LARGE'
  | 'EXTRACTION_FAILED'
  | 'NO_ASSISTANT'
  | 'ASSISTANT_ERROR'
  | 'CONSENT_REQUIRED'
  | 'SOURCE_UNAVAILABLE'
  | 'BUSY'
  | 'CANCELLED'
  | 'INTERNAL';

/** An error that is safe to show: no paths, keys, stack traces or vendor names. */
export interface PublicError {
  code: FundingErrorCode;
  message: string;
  /** With CONSENT_REQUIRED: the acknowledgement the user has not given yet. */
  consent?: keyof OrgConsents;
}

/** Every funding-platform call returns one of these instead of throwing. */
export type Outcome<T> = { ok: true; value: T } | { ok: false; error: PublicError };

// ───────────────────────────────── identity ──────────────────────────────────

/** "CBO" is always written as the acronym in the product. */
export type OrganizationKind = 'business' | 'cbo';

export const ORGANIZATION_KIND_LABELS: Record<OrganizationKind, string> = {
  business: 'Business',
  cbo: 'CBO',
};

export type OrgRole = 'owner' | 'admin' | 'member' | 'viewer';
export type MembershipStatus = 'active' | 'suspended';

/** Local mode is the only provider today; the others are reserved names. */
export type AuthMode = 'local' | 'oidc' | 'saml';

export type Permission =
  | 'organization.read'
  | 'organization.manage'
  | 'members.read'
  | 'members.manage'
  | 'settings.read'
  | 'settings.manage'
  | 'audit.read'
  // Knowledge Hub: view documents, status and the approved profile.
  | 'knowledge.read'
  // Upload, replace, delete and recategorize documents; edit draft claims.
  | 'knowledge.manage'
  // Approve or reject profile claims and confirmed priorities.
  | 'profile.approve'
  // Search opportunities; read RFP analyses and guides.
  | 'funding.read'
  // Upload RFPs, run analyses, save opportunities, start guides.
  | 'funding.manage';

export interface LocalProfile {
  schemaVersion: 1;
  id: string;
  displayName: string;
  email: string;
  createdAt: number;
  updatedAt: number;
}

export interface OrgLocation {
  /** ISO 3166-1 alpha-2, e.g. "US". */
  country: string;
  /** State, province or region, as the postal abbreviation where one exists. */
  region: string;
  county: string;
  city: string;
}

/** One-time acknowledgements required before data leaves the device. */
export interface OrgConsents {
  /** Excerpts of uploaded documents may be sent to the connected assistant. */
  documentAnalysisAt: number | null;
  /** Search terms and filters may be sent to the official funding sources. */
  liveFundingSearchAt: number | null;
}

export interface Organization {
  schemaVersion: 1;
  id: string;
  name: string;
  kind: OrganizationKind;
  location: OrgLocation;
  consents: OrgConsents;
  createdAt: number;
  updatedAt: number;
}

export interface Membership {
  organizationId: string;
  userId: string;
  role: OrgRole;
  status: MembershipStatus;
  createdAt: number;
  updatedAt: number;
}

export interface SessionInfo {
  id: string;
  userId: string;
  /** Null until an organization exists and is selected. */
  organizationId: string | null;
  authMode: AuthMode;
  issuedAt: number;
  /** Null in local mode, where the session lasts as long as the device login. */
  expiresAt: number | null;
  role: OrgRole | null;
  permissions: Permission[];
}

export interface IdentityState {
  profile: LocalProfile;
  organizations: Organization[];
  memberships: Membership[];
  session: SessionInfo;
}

export interface NewOrganizationInput {
  name: string;
  kind: OrganizationKind;
  location: OrgLocation;
}

/** An entry in an organization's activity record. Never contains document text. */
export interface OrgActivity {
  id: string;
  organizationId: string;
  at: number;
  actorId: string;
  action:
    | 'organization_created'
    | 'organization_updated'
    | 'document_added'
    | 'document_replaced'
    | 'document_deleted'
    | 'profile_extracted'
    | 'claims_approved'
    | 'claims_rejected'
    | 'claim_edited'
    | 'claim_added'
    | 'claim_deleted'
    | 'conflict_resolved'
    | 'rfp_added'
    | 'rfp_deleted'
    | 'rfp_analyzed'
    | 'alignment_assessed'
    | 'guide_started'
    | 'opportunity_saved'
    | 'opportunity_removed'
    | 'consent_recorded';
  /** A short label such as a file name or a count; safe to display. */
  detail: string;
}

// ──────────────────────────────── documents ──────────────────────────────────

export type DocumentFormat = 'pdf' | 'docx' | 'txt' | 'md';

export const ACCEPTED_EXTENSIONS: Record<DocumentFormat, string[]> = {
  pdf: ['pdf'],
  docx: ['docx'],
  txt: ['txt'],
  md: ['md', 'markdown'],
};

/** Largest file the app will read, in bytes (40 MB). */
export const MAX_DOCUMENT_BYTES = 40 * 1024 * 1024;

export type KnowledgeCategory =
  | 'strategic_plan'
  | 'organizational_profile'
  | 'program_description'
  | 'impact_report'
  | 'budget'
  | 'previous_proposal'
  | 'other';

export const KNOWLEDGE_CATEGORY_LABELS: Record<KnowledgeCategory, string> = {
  strategic_plan: 'Strategic plan',
  organizational_profile: 'Organizational profile',
  program_description: 'Program description',
  impact_report: 'Impact report',
  budget: 'Budget',
  previous_proposal: 'Previous proposal',
  other: 'Other document',
};

export type ProcessingStatus = 'queued' | 'extracting' | 'indexing' | 'ready' | 'failed';

/** A document in an organization's permanent Knowledge Hub. */
export interface KnowledgeDocument {
  id: string;
  organizationId: string;
  name: string;
  format: DocumentFormat;
  category: KnowledgeCategory;
  sizeBytes: number;
  sha256: string;
  /** Starts at 1 and increases each time the file is replaced. */
  version: number;
  status: ProcessingStatus;
  /** Why processing failed, in words the user can act on. Empty otherwise. */
  statusDetail: string;
  /** Non-fatal findings, e.g. "2 pages have no readable text". */
  warnings: string[];
  /** Pages for PDFs; null for formats without pages. */
  pageCount: number | null;
  blockCount: number;
  wordCount: number;
  uploadedAt: number;
  updatedAt: number;
  uploadedBy: string;
}

/**
 * A pointer into text the app extracted. `quote` is sliced from that stored
 * text after verification; it is never the wording a model returned.
 */
export interface Citation {
  documentId: string;
  documentName: string;
  documentVersion: number;
  blockId: string;
  /** 1-based page for PDFs; null otherwise. */
  page: number | null;
  /** Heading path for formats with headings, e.g. "Eligibility › Applicants". */
  section: string;
  quote: string;
  /** "approximate" means near-identical wording with every number unchanged. */
  match: 'exact' | 'approximate';
}

/** A ranked passage from one organization's searchable knowledge. */
export interface KnowledgePassage {
  documentId: string;
  documentName: string;
  documentVersion: number;
  category: KnowledgeCategory;
  blockIds: string[];
  page: number | null;
  section: string;
  text: string;
  score: number;
}

// ───────────────────────────── organization profile ───────────────────────────

export const PROFILE_FIELDS = [
  'mission',
  'populations_served',
  'geographic_scope',
  'strategic_priorities',
  'programs',
  'strengths',
  'impact_evidence',
  'capacity',
  'funding_goals',
] as const;

export type ProfileFieldId = (typeof PROFILE_FIELDS)[number];

export const PROFILE_FIELD_LABELS: Record<ProfileFieldId, string> = {
  mission: 'Mission',
  populations_served: 'Populations served',
  geographic_scope: 'Geographic scope',
  strategic_priorities: 'Strategic priorities',
  programs: 'Programs',
  strengths: 'Demonstrated strengths',
  impact_evidence: 'Impact evidence',
  capacity: 'Capacity',
  funding_goals: 'Funding goals',
};

/**
 * proposed      — found in documents or suggested; not yet part of the profile.
 * approved      — confirmed by a person; the only claims used as baseline context.
 * needs_review  — was approved, but its evidence changed; not used until re-confirmed.
 * rejected      — declined; kept so the same suggestion is not offered again.
 */
export type ClaimStatus = 'proposed' | 'approved' | 'needs_review' | 'rejected';

/**
 * extracted — written by the assistant from cited passages.
 * verbatim  — an exact passage offered without an assistant (no rewording).
 * user      — written or edited by a person.
 */
export type ClaimOrigin = 'extracted' | 'verbatim' | 'user';

export type ReviewReason =
  | 'source_deleted'
  | 'source_replaced'
  | 'evidence_missing'
  | 'conflict';

export interface ProfileClaim {
  id: string;
  field: ProfileFieldId;
  text: string;
  origin: ClaimOrigin;
  status: ClaimStatus;
  /** Empty for statements a person entered without pointing at a document. */
  citations: Citation[];
  /** Set when status is needs_review. */
  reviewReason: ReviewReason | null;
  /** A plain sentence explaining the review reason, for display. */
  reviewNote: string;
  /** Id of the approved claim this proposal would replace, if any. */
  supersedesClaimId: string | null;
  /** True once a person has changed the wording of an extracted claim. */
  edited: boolean;
  createdAt: number;
  updatedAt: number;
  approvedAt: number | null;
  approvedBy: string | null;
}

/** Documents disagree. Shown to the user; never settled by the app. */
export interface ProfileConflict {
  id: string;
  field: ProfileFieldId;
  summary: string;
  claimIds: string[];
  resolvedAt: number | null;
}

/** A field the documents do not cover. */
export interface ProfileGap {
  field: ProfileFieldId;
  note: string;
}

export interface ProfileExtractionState {
  /** unavailable: no assistant is connected; verbatim suggestions still work. */
  status: 'idle' | 'running' | 'failed' | 'unavailable';
  lastRunAt: number | null;
  /** How the most recent proposals were produced. */
  method: 'assistant' | 'verbatim' | null;
  error: string;
}

export interface OrganizationProfile {
  schemaVersion: 1;
  organizationId: string;
  claims: ProfileClaim[];
  conflicts: ProfileConflict[];
  gaps: ProfileGap[];
  extraction: ProfileExtractionState;
  /** When a person last approved claims. Null until the first approval. */
  approvedAt: number | null;
  approvedBy: string | null;
  updatedAt: number;
}

export type SetupStepId =
  | 'organization'
  | 'documents'
  | 'processing'
  | 'profile_draft'
  | 'profile_approved';

export interface SetupStep {
  id: SetupStepId;
  label: string;
  done: boolean;
  detail: string;
}

export interface SetupStatus {
  steps: SetupStep[];
  completed: number;
  total: number;
  /** True once at least one claim is approved; tailored guidance needs this. */
  readyForTailoredGuidance: boolean;
  /** One sentence telling the user what to do next. */
  nextAction: string;
  counts: {
    documents: number;
    documentsReady: number;
    documentsFailed: number;
    claimsProposed: number;
    claimsApproved: number;
    claimsNeedingReview: number;
    openConflicts: number;
  };
}

// ───────────────────────────── funding opportunities ──────────────────────────

export type GeoLevel = 'city' | 'county' | 'state' | 'federal' | 'international';

export const GEO_LEVEL_LABELS: Record<GeoLevel, string> = {
  city: 'Citywide',
  county: 'Countywide',
  state: 'Statewide',
  federal: 'Federal',
  international: 'International',
};

/**
 * grant                  — money awarded for a purpose, competitive or formula.
 * contract_solicitation  — a request for proposals or bids to deliver a service.
 */
export type OpportunityKind = 'grant' | 'contract_solicitation';

export const OPPORTUNITY_KIND_LABELS: Record<OpportunityKind, string> = {
  grant: 'Grant',
  contract_solicitation: 'Contract solicitation',
};

export type ApplicantType =
  | 'nonprofit'
  | 'small_business'
  | 'for_profit'
  | 'local_government'
  | 'state_government'
  | 'tribal'
  | 'education'
  | 'individual'
  | 'other';

export const APPLICANT_TYPE_LABELS: Record<ApplicantType, string> = {
  nonprofit: 'CBOs and other nonprofits',
  small_business: 'Small businesses',
  for_profit: 'Other businesses',
  local_government: 'Local governments',
  state_government: 'State governments',
  tribal: 'Tribal governments and organizations',
  education: 'Schools, colleges and universities',
  individual: 'Individuals',
  other: 'Other applicants',
};

export type FundingCategory =
  | 'agriculture_food'
  | 'arts_culture_humanities'
  | 'business_economic_development'
  | 'community_development'
  | 'disaster_emergency'
  | 'education'
  | 'employment_workforce'
  | 'energy'
  | 'environment_natural_resources'
  | 'health'
  | 'housing'
  | 'human_services'
  | 'justice_public_safety'
  | 'science_technology_research'
  | 'transportation_infrastructure'
  | 'other';

export const FUNDING_CATEGORY_LABELS: Record<FundingCategory, string> = {
  agriculture_food: 'Agriculture and food',
  arts_culture_humanities: 'Arts, culture and humanities',
  business_economic_development: 'Business and economic development',
  community_development: 'Community development',
  disaster_emergency: 'Disaster and emergency',
  education: 'Education',
  employment_workforce: 'Employment and workforce',
  energy: 'Energy',
  environment_natural_resources: 'Environment and natural resources',
  health: 'Health',
  housing: 'Housing',
  human_services: 'Human services',
  justice_public_safety: 'Justice and public safety',
  science_technology_research: 'Science, technology and research',
  transportation_infrastructure: 'Transportation and infrastructure',
  other: 'Other',
};

/**
 * active      — an official source reports it open, the app read a deadline that
 *               has not passed (or the source says it is ongoing), and that was
 *               checked in this session.
 * expired     — the source reports it closed, or the deadline has passed.
 * unverified  — anything else: forecasts, missing or implausible deadlines, a
 *               failed check, a stale result, or a listing a person added.
 */
export type OpportunityStatus = 'active' | 'expired' | 'unverified';

export const OPPORTUNITY_STATUS_LABELS: Record<OpportunityStatus, string> = {
  active: 'Active',
  expired: 'Expired',
  unverified: 'Unverified',
};

export type UnverifiedReason =
  | 'forecast'
  | 'no_deadline'
  | 'implausible_deadline'
  | 'detail_unavailable'
  | 'source_contradiction'
  | 'stale'
  | 'no_official_link';

export interface Opportunity {
  /** `${sourceId}:${record id at the source}`. */
  id: string;
  sourceId: string;
  /** The official source's name, shown beside every listing. */
  sourceName: string;
  /** Agency or body offering the funding. */
  funder: string;
  kind: OpportunityKind;
  /**
   * The funder's tier in its own country. A listing from another country than
   * the organization's is treated as international when filtering, whatever
   * its tier.
   */
  level: GeoLevel;
  /** ISO 3166-1 alpha-2 of the funder's country; empty for multi-country bodies. */
  country: string;
  /** State, province or region code the listing is limited to; empty if none. */
  region: string;
  /** Where the funder has jurisdiction, e.g. "United States", "California". */
  jurisdiction: string;
  /** Geographic limits stated by the source, when it states any. */
  geographyNote: string;
  title: string;
  /** Plain text; HTML from the source is removed. */
  summary: string;
  /** The funder's own reference number, when it has one. */
  number: string;
  applicantTypes: ApplicantType[];
  /** The source's own eligibility wording, when it adds to the coded types. */
  applicantNote: string;
  categories: FundingCategory[];
  /** Null means the source does not state it. Never substitute zero. */
  awardFloor: number | null;
  awardCeiling: number | null;
  totalFunding: number | null;
  /** ISO 4217, e.g. "USD". */
  currency: string;
  /** ISO date (YYYY-MM-DD) in the source's own time zone, or null. */
  openDate: string | null;
  closeDate: string | null;
  /** The deadline exactly as the source words it. */
  closeDateText: string;
  status: OpportunityStatus;
  /** One sentence explaining the status, for display beside the badge. */
  statusReason: string;
  unverifiedReason: UnverifiedReason | null;
  /** The status value as the source reports it. */
  sourceStatus: string;
  /** Link to the listing on the official source. */
  officialUrl: string;
  /** When the app read this from the source (epoch ms). */
  fetchedAt: number;
  /** How well it fits the approved profile; null when no profile is approved. */
  match: OpportunityMatch | null;
}

export interface OpportunityMatch {
  /** 0–100, computed on the device from shared terms; not a prediction of award. */
  score: number;
  /** Terms the listing shares with the approved profile. */
  sharedTerms: string[];
  /** Profile fields those terms came from. */
  fields: ProfileFieldId[];
}

export interface PlaceFilter {
  country: string;
  region: string;
  county: string;
  city: string;
}

export interface OpportunityFilters {
  query: string;
  levels: GeoLevel[];
  place: PlaceFilter;
  applicantTypes: ApplicantType[];
  categories: FundingCategory[];
  kinds: OpportunityKind[];
  amountMin: number | null;
  amountMax: number | null;
  /** Keep listings whose source does not state an amount. */
  includeAmountNotStated: boolean;
  /** ISO dates, inclusive. */
  deadlineFrom: string | null;
  deadlineTo: string | null;
  statuses: OpportunityStatus[];
  /** Empty means every source that covers the chosen levels and place. */
  sourceIds: string[];
}

export const DEFAULT_OPPORTUNITY_FILTERS: OpportunityFilters = {
  query: '',
  levels: [],
  place: { country: '', region: '', county: '', city: '' },
  applicantTypes: [],
  categories: [],
  kinds: [],
  amountMin: null,
  amountMax: null,
  includeAmountNotStated: true,
  deadlineFrom: null,
  deadlineTo: null,
  statuses: ['active'],
  sourceIds: [],
};

/** An official source the app can query live. */
export interface FundingSourceInfo {
  id: string;
  name: string;
  operator: string;
  level: GeoLevel;
  jurisdiction: string;
  /** Country and region the source covers; empty region means the whole country. */
  coverage: { country: string; region: string; county: string; city: string };
  kinds: OpportunityKind[];
  /** Human-facing home of the source. */
  homepageUrl: string;
  /** Licence or attribution the source asks for; empty when none is stated. */
  attribution: string;
  /** Which filters the source applies itself; the rest are applied on the device. */
  note: string;
}

export interface SourceRunReport {
  sourceId: string;
  sourceName: string;
  state: 'ok' | 'failed' | 'skipped';
  /** Listings returned by this source before filtering on the device. */
  received: number;
  /** Listings from this source that remain after filtering. */
  matched: number;
  fetchedAt: number;
  durationMs: number;
  /** Why it failed or was skipped, in plain words. */
  message: string;
}

export interface OpportunitySearchResult {
  opportunities: Opportunity[];
  reports: SourceRunReport[];
  /** True when more listings matched than are returned. */
  truncated: boolean;
  searchedAt: number;
}

/** Extra facts read from the official source for one listing. */
export interface OpportunityDetail {
  opportunity: Opportunity;
  /** Longer description from the source, as plain text. */
  description: string;
  /** Labelled facts the source provides, e.g. "Cost sharing: Yes". */
  facts: { label: string; value: string }[];
  /** Other official links the source attaches. */
  links: { label: string; url: string }[];
}

/** A human-facing official page. Shown as a link, never as a listing. */
export interface OfficialPortal {
  id: string;
  name: string;
  operator: string;
  level: GeoLevel;
  jurisdiction: string;
  country: string;
  region: string;
  url: string;
  /** ISO date the link was last checked. */
  checkedOn: string;
  /** False when the site blocked the automated check; the link may still work. */
  reachable: boolean;
  notes: string;
}

export interface SavedOpportunity {
  organizationId: string;
  opportunity: Opportunity;
  savedAt: number;
  note: string;
  /** When the status was last re-read from the source. */
  recheckedAt: number;
}

// ─────────────────────────────── RFP analysis ─────────────────────────────────

/**
 * upload  — a solicitation file the user uploaded.
 * listing — the official listing text of a saved opportunity, read from its source.
 */
export type FundingDocumentOrigin = 'upload' | 'listing';

/**
 * A funding document under analysis. Kept apart from the Knowledge Hub: it is
 * never indexed with, or allowed to change, the organization's own profile.
 */
export interface RfpDocument {
  id: string;
  organizationId: string;
  origin: FundingDocumentOrigin;
  /** Set when origin is "listing". */
  opportunityId: string;
  name: string;
  format: DocumentFormat;
  sizeBytes: number;
  sha256: string;
  status: ProcessingStatus;
  statusDetail: string;
  warnings: string[];
  pageCount: number | null;
  blockCount: number;
  wordCount: number;
  uploadedAt: number;
  updatedAt: number;
  analysisStatus: AnalysisStatus;
  alignmentStatus: AnalysisStatus;
}

export interface AnalysisStatus {
  state: 'none' | 'running' | 'ready' | 'failed';
  updatedAt: number | null;
  error: string;
}

export const RFP_SECTIONS = [
  'purpose',
  'priorities',
  'outcomes',
  'eligibility',
  'supported_activities',
  'award_amounts',
  'matching',
  'funding_period',
  'deadlines',
  'evaluation_criteria',
  'required_documents',
  'submission_steps',
  'reporting',
] as const;

export type RfpSectionId = (typeof RFP_SECTIONS)[number];

export const RFP_SECTION_LABELS: Record<RfpSectionId, string> = {
  purpose: 'Investment purpose',
  priorities: 'Strategic priorities',
  outcomes: 'Intended outcomes',
  eligibility: 'Who is eligible',
  supported_activities: 'Supported activities and expenses',
  award_amounts: 'Award amounts',
  matching: 'Matching requirements',
  funding_period: 'Funding period',
  deadlines: 'Deadlines',
  evaluation_criteria: 'Evaluation criteria',
  required_documents: 'Required documents',
  submission_steps: 'Submission steps',
  reporting: 'Reporting obligations',
};

/**
 * explicit        — the document states it; the citation shows the wording.
 * interpretation  — the assistant's reading of the document; check the citation.
 */
export type StatementBasis = 'explicit' | 'interpretation';

export interface RfpItem {
  id: string;
  text: string;
  basis: StatementBasis;
  citations: Citation[];
  /** True when a figure or date in the text is not in the cited wording. */
  needsReview: boolean;
}

export interface RfpSection {
  id: RfpSectionId;
  items: RfpItem[];
  /**
   * stated   — the document covers this.
   * unclear  — the document mentions it without enough detail to rely on.
   * missing  — the document does not cover this.
   */
  coverage: 'stated' | 'unclear' | 'missing';
  /** What is unclear or missing, in one or two sentences. */
  note: string;
}

export interface GlossaryTerm {
  term: string;
  plainLanguage: string;
  citations: Citation[];
}

/** A point for the applicant to resolve. `citations` may be empty. */
export interface AnalysisNote {
  id: string;
  text: string;
  citations: Citation[];
}

/**
 * What the funder says about using AI tools in an application.
 * The proposal guide narrows what it offers when this is restricted or prohibited.
 */
export type AiUseStance =
  | 'not_stated'
  | 'permitted'
  | 'permitted_with_disclosure'
  | 'restricted'
  | 'prohibited';

export interface AiUsePolicy {
  stance: AiUseStance;
  summary: string;
  citations: Citation[];
}

/** A phrase found by pattern matching, with no interpretation applied. */
export interface LiteralFinding {
  kind: 'date' | 'amount' | 'requirement' | 'match' | 'ai_tools';
  text: string;
  citation: Citation;
}

export interface RfpAnalysis {
  schemaVersion: 1;
  rfpId: string;
  organizationId: string;
  /** assistant: full educational summary. text_matches: literal findings only. */
  method: 'assistant' | 'text_matches';
  createdAt: number;
  /** Two or three plain sentences on what the funder is investing in. */
  overview: string;
  sections: RfpSection[];
  glossary: GlossaryTerm[];
  aiUse: AiUsePolicy;
  /** Things the document leaves open that the applicant should settle. */
  uncertainties: AnalysisNote[];
  /** Questions to ask the funder or answer internally before applying. */
  questions: AnalysisNote[];
  /** Always present, whichever method produced the rest. */
  literalFindings: LiteralFinding[];
  /** Pages or sections the analysis could not read. */
  limitations: string[];
}

/** A documented fact about the organization, with where it is written down. */
export interface DocumentedFact {
  text: string;
  citations: Citation[];
  /** Id of the approved claim it rests on, when it rests on one. */
  claimId: string | null;
}

export type AlignmentFinding = 'documented' | 'partial' | 'gap' | 'not_documented' | 'unassessed';

export const ALIGNMENT_FINDING_LABELS: Record<AlignmentFinding, string> = {
  documented: 'Documented',
  partial: 'Partly documented',
  gap: 'Gap',
  not_documented: 'Not in the documents',
  unassessed: 'Not assessed',
};

export interface AlignmentItem {
  id: string;
  /** What is being compared, e.g. "Eligibility: nonprofit status". */
  topic: string;
  section: RfpSectionId;
  /**
   * documented  — the organization's documents show it meets this.
   * partial     — the documents show part of it.
   * gap         — the documents show it is not met.
   * not_documented — nothing in the approved profile or documents speaks to it.
   * unassessed  — no judgement was made (no assistant is connected); passages
   *               that may relate are listed for the user to read.
   */
  finding: AlignmentFinding;
  /** What the funder asks for, cited to the funding document. */
  requirement: RfpItem;
  /** What the organization's own documents say, cited to them. */
  facts: DocumentedFact[];
  /** The assistant's suggestion. Always shown under a "Recommendation" label. */
  recommendation: string;
}

export interface AlignmentReport {
  profileClaimIds?: string[];
  /** Recomputed when read; historical results must be assessed again after evidence changes. */
  stale?: boolean;
  schemaVersion: 1;
  rfpId: string;
  organizationId: string;
  createdAt: number;
  /** The profile approval this was assessed against. */
  profileApprovedAt: number | null;
  method: 'assistant' | 'passages';
  summary: string;
  items: AlignmentItem[];
  gaps: AnalysisNote[];
  uncertainties: AnalysisNote[];
  questions: AnalysisNote[];
}

// ───────────────────── ethical strengths-based proposal guide ─────────────────

/**
 * full     — outlines, reflective questions, evidence prompts and feedback.
 * limited  — the funder restricts or prohibits AI assistance: reflective
 *            questions and checklists only, and no feedback on draft text.
 */
export type GuideMode = 'full' | 'limited';

export interface GuideQuestion {
  id: string;
  text: string;
  /** Why the question matters, tied to a funder criterion where there is one. */
  why: string;
}

export interface GuideOutlineSection {
  id: string;
  heading: string;
  /** What this part of a proposal needs to do for the reader. */
  purpose: string;
  /** Funder criteria this section answers, cited to the funding document. */
  criteria: RfpItem[];
  /** Strengths the organization has documented that belong here. */
  strengths: DocumentedFact[];
  questions: GuideQuestion[];
  /** Evidence to gather that the documents do not yet contain. */
  evidenceToGather: string[];
}

export type FeedbackKind =
  | 'strength'
  | 'clarity'
  | 'evidence_gap'
  | 'unsupported_claim'
  | 'alignment'
  | 'requirement';

/** An observation about the user's own draft. Never rewritten text. */
export interface GuideObservation {
  id: string;
  kind: FeedbackKind;
  text: string;
  /** The words in the user's draft this refers to, copied exactly. */
  draftExcerpt: string;
  citations: Citation[];
}

export interface GuideFeedback {
  id: string;
  sectionId: string;
  createdAt: number;
  observations: GuideObservation[];
}

export interface GuideSession {
  profileClaimIds?: string[];
  profileApprovedAt?: number | null;
  /** Historical guidance whose profile, evidence or funding analysis changed. */
  stale?: boolean;
  schemaVersion: 1;
  id: string;
  organizationId: string;
  /** The funding document this guide is for; empty for a general guide. */
  rfpId: string;
  title: string;
  mode: GuideMode;
  aiUse: AiUsePolicy;
  method: 'assistant' | 'standard';
  /** Ground rules shown at the top of every guide. */
  principles: string[];
  outline: GuideOutlineSection[];
  feedback: GuideFeedback[];
  createdAt: number;
  updatedAt: number;
}

// ─────────────────────────────── jobs and events ──────────────────────────────

export type JobKind =
  | 'document_processing'
  | 'profile_extraction'
  | 'rfp_processing'
  | 'rfp_analysis'
  | 'alignment'
  | 'guide'
  | 'guide_feedback';

export interface JobProgress {
  id: string;
  kind: JobKind;
  organizationId: string;
  /** The document, RFP or guide the job belongs to, when it has one. */
  subjectId: string;
  state: 'running' | 'completed' | 'failed' | 'cancelled';
  /** What is happening now, in words. */
  message: string;
  /** 0–100, or null when progress cannot be measured. */
  percent: number | null;
  startedAt: number;
  finishedAt: number | null;
  error: PublicError | null;
}

/** Pushed from main; the renderer re-reads what changed. */
export type FundingEvent =
  | { kind: 'identity_changed' }
  | { kind: 'documents_changed'; organizationId: string }
  | { kind: 'profile_changed'; organizationId: string }
  | { kind: 'rfps_changed'; organizationId: string }
  | { kind: 'guides_changed'; organizationId: string }
  | { kind: 'saved_changed'; organizationId: string }
  | { kind: 'job'; job: JobProgress };

/** How the assistant engine can help with funding work right now. */
export interface AssistantAvailability {
  /** True when a cloud engine is connected and can analyze documents. */
  connected: boolean;
  /** What works without one, for display. */
  note: string;
}

// ─────────────────────────────── bridge surface ───────────────────────────────

export interface NewClaimInput {
  field: ProfileFieldId;
  text: string;
  /** Passages the user picked as evidence; verified again in main. */
  evidence: { documentId: string; blockId: string; quote: string }[];
}

export interface FundingBridge {
  identity: {
    get(): Promise<Outcome<IdentityState>>;
    updateProfile(patch: { displayName?: string; email?: string }): Promise<Outcome<IdentityState>>;
    createOrganization(input: NewOrganizationInput): Promise<Outcome<IdentityState>>;
    updateOrganization(
      organizationId: string,
      patch: Partial<NewOrganizationInput>,
    ): Promise<Outcome<IdentityState>>;
    switchOrganization(organizationId: string): Promise<Outcome<IdentityState>>;
    /** Removes the organization and every document, profile, RFP and guide it holds. */
    deleteOrganization(organizationId: string): Promise<Outcome<IdentityState>>;
    recordConsent(consent: keyof OrgConsents): Promise<Outcome<IdentityState>>;
    can(permission: Permission): Promise<Outcome<boolean>>;
    activity(limit?: number): Promise<Outcome<OrgActivity[]>>;
    assistant(): Promise<Outcome<AssistantAvailability>>;
  };
  knowledge: {
    listDocuments(): Promise<Outcome<KnowledgeDocument[]>>;
    /** Read extracted passages from a document in the active organization. */
    documentPassages(documentId: string): Promise<Outcome<KnowledgePassage[]>>;
    /** Opens the system file picker; returns the documents that were added. */
    addDocuments(category?: KnowledgeCategory): Promise<Outcome<KnowledgeDocument[]>>;
    /** Opens the picker and swaps the file behind an existing document. */
    replaceDocument(documentId: string): Promise<Outcome<KnowledgeDocument | null>>;
    setCategory(documentId: string, category: KnowledgeCategory): Promise<Outcome<KnowledgeDocument>>;
    retryDocument(documentId: string): Promise<Outcome<KnowledgeDocument>>;
    deleteDocument(documentId: string): Promise<Outcome<null>>;
    search(query: string, limit?: number): Promise<Outcome<KnowledgePassage[]>>;
    setupStatus(): Promise<Outcome<SetupStatus>>;
    getProfile(): Promise<Outcome<OrganizationProfile>>;
    /** Proposes claims from the documents. Never changes approved claims. */
    extractProfile(): Promise<Outcome<{ jobId: string }>>;
    /** Passages that may speak to a field, for writing a claim by hand. */
    suggestPassages(field: ProfileFieldId): Promise<Outcome<KnowledgePassage[]>>;
    approveClaims(claimIds: string[]): Promise<Outcome<OrganizationProfile>>;
    rejectClaims(claimIds: string[]): Promise<Outcome<OrganizationProfile>>;
    addClaim(input: NewClaimInput): Promise<Outcome<OrganizationProfile>>;
    updateClaim(claimId: string, text: string): Promise<Outcome<OrganizationProfile>>;
    deleteClaim(claimId: string): Promise<Outcome<OrganizationProfile>>;
    /** Marks a conflict settled, keeping the named claims and rejecting the rest. */
    resolveConflict(conflictId: string, keepClaimIds: string[]): Promise<Outcome<OrganizationProfile>>;
  };
  opportunities: {
    sources(): Promise<Outcome<FundingSourceInfo[]>>;
    portals(filter?: { level?: GeoLevel; country?: string; region?: string }): Promise<Outcome<OfficialPortal[]>>;
    /** Filters drawn from the approved profile, with the claims they came from. */
    suggestFilters(): Promise<Outcome<{ filters: OpportunityFilters; basis: string[] }>>;
    search(filters: OpportunityFilters): Promise<Outcome<OpportunitySearchResult>>;
    detail(opportunityId: string): Promise<Outcome<OpportunityDetail>>;
    listSaved(): Promise<Outcome<SavedOpportunity[]>>;
    save(opportunity: Opportunity): Promise<Outcome<SavedOpportunity[]>>;
    unsave(opportunityId: string): Promise<Outcome<SavedOpportunity[]>>;
    setNote(opportunityId: string, note: string): Promise<Outcome<SavedOpportunity[]>>;
    /** Re-reads every saved listing from its source and updates its status. */
    recheckSaved(): Promise<Outcome<SavedOpportunity[]>>;
  };
  rfps: {
    list(): Promise<Outcome<RfpDocument[]>>;
    /** Opens the system file picker; returns the funding documents added. */
    add(): Promise<Outcome<RfpDocument[]>>;
    /** Reads a saved opportunity's official listing as a funding document. */
    addFromOpportunity(opportunityId: string): Promise<Outcome<RfpDocument>>;
    addFromUrl(url: string): Promise<Outcome<RfpDocument>>;
    remove(rfpId: string): Promise<Outcome<null>>;
    analysis(rfpId: string): Promise<Outcome<RfpAnalysis | null>>;
    analyze(rfpId: string): Promise<Outcome<{ jobId: string }>>;
    alignment(rfpId: string): Promise<Outcome<AlignmentReport | null>>;
    assessAlignment(rfpId: string): Promise<Outcome<{ jobId: string }>>;
  };
  guides: {
    list(): Promise<Outcome<GuideSession[]>>;
    get(guideId: string): Promise<Outcome<GuideSession | null>>;
    /** An empty rfpId starts a general guide grounded only in the profile. */
    start(rfpId: string): Promise<Outcome<{ jobId: string }>>;
    /** Feedback on the user's own words. The draft is not stored. */
    requestFeedback(guideId: string, sectionId: string, draft: string): Promise<Outcome<{ jobId: string }>>;
    remove(guideId: string): Promise<Outcome<null>>;
  };
  jobs: {
    list(): Promise<Outcome<JobProgress[]>>;
    cancel(jobId: string): Promise<Outcome<null>>;
  };
  onEvent(callback: (event: FundingEvent) => void): () => void;
}

// ───────────────────────── calls, permissions and roles ───────────────────────

export type FundingNamespace = Exclude<keyof FundingBridge, 'onEvent'>;

/**
 * Every call the renderer can make, with the permission it needs. `null` means
 * any local user may make it. Main refuses anything not listed here, and checks
 * the permission against the active organization before the call runs.
 */
export const FUNDING_METHODS: {
  [N in FundingNamespace]: Record<keyof FundingBridge[N], Permission | null>;
} = {
  identity: {
    get: null,
    updateProfile: null,
    createOrganization: null,
    updateOrganization: 'organization.manage',
    switchOrganization: null,
    deleteOrganization: 'organization.manage',
    recordConsent: 'settings.manage',
    can: null,
    activity: 'audit.read',
    assistant: null,
  },
  knowledge: {
    listDocuments: 'knowledge.read',
    documentPassages: 'knowledge.read',
    addDocuments: 'knowledge.manage',
    replaceDocument: 'knowledge.manage',
    setCategory: 'knowledge.manage',
    retryDocument: 'knowledge.manage',
    deleteDocument: 'knowledge.manage',
    search: 'knowledge.read',
    setupStatus: 'knowledge.read',
    getProfile: 'knowledge.read',
    extractProfile: 'knowledge.manage',
    suggestPassages: 'knowledge.read',
    approveClaims: 'profile.approve',
    rejectClaims: 'profile.approve',
    addClaim: 'knowledge.manage',
    updateClaim: 'knowledge.manage',
    deleteClaim: 'knowledge.manage',
    resolveConflict: 'profile.approve',
  },
  opportunities: {
    sources: null,
    portals: null,
    suggestFilters: 'knowledge.read',
    search: 'funding.read',
    detail: 'funding.read',
    listSaved: 'funding.read',
    save: 'funding.manage',
    unsave: 'funding.manage',
    setNote: 'funding.manage',
    recheckSaved: 'funding.manage',
  },
  rfps: {
    list: 'funding.read',
    add: 'funding.manage',
    addFromOpportunity: 'funding.manage',
    addFromUrl: 'funding.manage',
    remove: 'funding.manage',
    analysis: 'funding.read',
    analyze: 'funding.manage',
    alignment: 'funding.read',
    assessAlignment: 'funding.manage',
  },
  guides: {
    list: 'funding.read',
    get: 'funding.read',
    start: 'funding.manage',
    requestFeedback: 'funding.manage',
    remove: 'funding.manage',
  },
  jobs: {
    list: null,
    cancel: null,
  },
};

const ALL_PERMISSIONS: Permission[] = [
  'organization.read',
  'organization.manage',
  'members.read',
  'members.manage',
  'settings.read',
  'settings.manage',
  'audit.read',
  'knowledge.read',
  'knowledge.manage',
  'profile.approve',
  'funding.read',
  'funding.manage',
];

/**
 * What each role may do. Owners hold everything. Admins run the organization's
 * work but cannot rename or delete it. Members add documents and do funding
 * work but cannot approve the profile. Viewers read.
 */
export const ROLE_PERMISSIONS: Record<OrgRole, readonly Permission[]> = {
  owner: ALL_PERMISSIONS,
  admin: ALL_PERMISSIONS.filter((p) => p !== 'organization.manage'),
  member: [
    'organization.read',
    'members.read',
    'settings.read',
    'knowledge.read',
    'knowledge.manage',
    'funding.read',
    'funding.manage',
  ],
  viewer: ['organization.read', 'members.read', 'settings.read', 'knowledge.read', 'funding.read'],
};
