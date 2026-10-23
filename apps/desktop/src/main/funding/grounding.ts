// What a chat run is told about the organization the user is working in.
//
// The assistant panel is where "What can I help you with?" is asked, so its
// answers have to rest on the same material as the workspace: the approved
// profile, the organization's own documents, the funding document that is
// open, and listings read from official sources. This builds that grounding
// for one run, for the active organization only, and only for what the user's
// role and the organization's recorded consents allow.
//
// Everything that came from a document or a source is returned as reference
// material or as a tool result. The agent loop seals both as untrusted data.
// The only trusted text produced here is `systemNote`, which is written by
// this file and contains nothing from a document.

import type { ApiTool, ReferenceContextItem } from '@bullebrowser/agent-core';
import {
  APPLICANT_TYPE_LABELS,
  DEFAULT_OPPORTUNITY_FILTERS,
  FUNDING_CATEGORY_LABELS,
  GEO_LEVEL_LABELS,
  OPPORTUNITY_KIND_LABELS,
  OPPORTUNITY_STATUS_LABELS,
  ORGANIZATION_KIND_LABELS,
  PROFILE_FIELDS,
  PROFILE_FIELD_LABELS,
  RFP_SECTION_LABELS,
  type Citation,
  type Opportunity,
  type Organization,
  type ProfileClaim,
  type RfpAnalysis,
} from '../../shared/funding.js';
import type { ExtractedBlock } from '../documents/types.js';
import type { IdentityService } from '../identity/service.js';
import { readFilters } from '../opportunities/filters.js';
import { assertOpportunityId } from '../opportunities/saved-store.js';
import type { OpportunityService } from '../opportunities/service.js';
import { todayIn } from '../opportunities/status.js';
import { isFundingError } from './errors.js';
import type { KnowledgeHubApi, RfpStoreApi } from './services.js';

/** The parts of the platform a chat run reads from. */
export interface GroundingSources {
  knowledge: Pick<KnowledgeHubApi, 'baseline' | 'getProfile' | 'search' | 'profileTerms'>;
  rfps: Pick<RfpStoreApi, 'source' | 'analysis'>;
  opportunities: Pick<OpportunityService, 'search' | 'detail'>;
}

export interface ChatGrounding {
  /** The organization the run belongs to, or null when none is active. */
  organizationId: string | null;
  referenceContext: ReferenceContextItem[];
  tools: ApiTool[];
  /** Trusted lines for the system prompt. Holds no text from any document. */
  systemNote: string;
}

const MAX_DOCUMENT_CHARS = 60_000;
const MAX_LISTINGS = 12;
const MAX_PASSAGES = 10;
const MAX_DESCRIPTION_CHARS = 12_000;

const NO_ORGANIZATION =
  'No organization is set up in the funding workspace yet, so nothing about the user\'s organization is available to you. ' +
  'If the user asks for tailored funding guidance, invite them to add their organization and its documents in the workspace first.';

const NOT_SHARED =
  "The organization's documents and approved profile are not shared with you in this chat, because nobody with that authority has agreed to send excerpts to the assistant. " +
  'If the user asks about their own organization, say that an owner or admin can allow this in the Organization Knowledge Hub, and do not guess what the documents say.';

const SEARCH_NOT_ALLOWED =
  'Searching official funding sources is not turned on for this organization yet. An owner or admin can allow it from the Opportunities screen.';

function place(organization: Organization): string {
  const { city, county, region, country } = organization.location;
  return [city, county, region, country].filter(Boolean).join(', ');
}

function source(citation: Citation): string {
  const where = citation.page !== null ? `p. ${citation.page}` : citation.section;
  return where ? `${citation.documentName}, ${where}` : citation.documentName;
}

function profileText(organization: Organization, claims: ProfileClaim[], approvedAt: number | null): string {
  const lines = [
    `Organization: ${organization.name} (${ORGANIZATION_KIND_LABELS[organization.kind]})`,
    `Location: ${place(organization) || 'not stated'}`,
    '',
  ];
  if (claims.length === 0) {
    lines.push(
      'No profile statements have been approved yet. Tailored guidance should wait until the organization reviews and approves its profile in the Organization Knowledge Hub.',
    );
    return lines.join('\n');
  }
  lines.push(
    `Approved profile, confirmed by the organization's own people${approvedAt ? ` (last approved ${todayIn('UTC', approvedAt)})` : ''}.`,
    'Each statement is followed by the document it rests on. Statements still awaiting review are not part of the profile and are not shown.',
  );
  for (const field of PROFILE_FIELDS) {
    const stated = claims.filter((claim) => claim.field === field);
    if (stated.length === 0) continue;
    lines.push('', PROFILE_FIELD_LABELS[field]);
    for (const claim of stated) {
      const sources = claim.citations.map(source);
      lines.push(`- ${claim.text} [${sources.length > 0 ? `source: ${[...new Set(sources)].join('; ')}` : 'entered by the organization, no source document'}]`);
    }
  }
  return lines.join('\n');
}

function blockLine(block: ExtractedBlock): string {
  const where = block.page !== null ? `[p. ${block.page}] ` : block.section ? `[${block.section}] ` : '';
  return `${where}${block.kind === 'heading' ? '# ' : ''}${block.text}`;
}

function documentText(name: string, blocks: ExtractedBlock[]): string {
  const lines = [`Funding document: ${name}`, ''];
  let used = 0;
  let shown = 0;
  for (const block of blocks) {
    const line = blockLine(block);
    if (used + line.length > MAX_DOCUMENT_CHARS) break;
    lines.push(line);
    used += line.length;
    shown += 1;
  }
  if (shown < blocks.length) {
    lines.push('', `(The document continues: ${blocks.length - shown} more passages are not shown here. Say so if the answer may lie in the part you cannot see.)`);
  }
  return lines.join('\n');
}

function analysisText(analysis: RfpAnalysis): string {
  if (analysis.method !== 'assistant') return '';
  const lines = ['Summary made earlier in the app (each point was checked against the document):', analysis.overview];
  for (const section of analysis.sections) {
    if (section.items.length === 0) {
      lines.push('', `${RFP_SECTION_LABELS[section.id]}: ${section.coverage === 'missing' ? 'not covered in the document' : 'unclear in the document'}${section.note ? ` (${section.note})` : ''}`);
      continue;
    }
    lines.push('', RFP_SECTION_LABELS[section.id]);
    for (const item of section.items) {
      const cited = item.citations[0];
      lines.push(`- ${item.text} [${item.basis === 'explicit' ? 'stated in the document' : 'interpretation'}${cited ? `; ${source(cited)}` : ''}]`);
    }
  }
  lines.push('', `Funder's position on AI assistance: ${analysis.aiUse.stance.replace(/_/g, ' ')}. ${analysis.aiUse.summary}`);
  return lines.join('\n');
}

function listing(opportunity: Opportunity) {
  return {
    id: opportunity.id,
    title: opportunity.title,
    funder: opportunity.funder,
    source: opportunity.sourceName,
    kind: OPPORTUNITY_KIND_LABELS[opportunity.kind],
    level: GEO_LEVEL_LABELS[opportunity.level],
    jurisdiction: opportunity.jurisdiction,
    status: OPPORTUNITY_STATUS_LABELS[opportunity.status],
    statusReason: opportunity.statusReason,
    deadlineAsWorded: opportunity.closeDateText || 'Not stated',
    deadlineDate: opportunity.closeDate,
    awardFloor: opportunity.awardFloor,
    awardCeiling: opportunity.awardCeiling,
    totalFunding: opportunity.totalFunding,
    currency: opportunity.currency,
    whoMayApply: opportunity.applicantTypes.map((type) => APPLICANT_TYPE_LABELS[type]),
    whoMayApplyAsWorded: opportunity.applicantNote,
    categories: opportunity.categories.map((category) => FUNDING_CATEGORY_LABELS[category]),
    summary: opportunity.summary.slice(0, 600),
    officialLink: opportunity.officialUrl,
    readFromSourceAt: new Date(opportunity.fetchedAt).toISOString(),
  };
}

const failure = (error: unknown): { error: string } => ({
  error: isFundingError(error) ? error.message : 'That could not be completed. Try again.',
});

const stringList = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];

export async function groundChat(
  platform: GroundingSources | null,
  identity: Pick<IdentityService, 'requireOrganization' | 'can'>,
  input: { focusRfpId?: string; signal: AbortSignal; now: number },
): Promise<ChatGrounding> {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const notes = [`Today's date on the user's device is ${todayIn(zone, input.now)}.`];

  const active = platform ? await identity.requireOrganization().catch(() => null) : null;
  if (!platform || !active) {
    notes.push(NO_ORGANIZATION);
    return { organizationId: null, referenceContext: [], tools: [], systemNote: notes.join('\n') };
  }
  const { organization } = active;
  const { knowledge, rfps, opportunities } = platform;
  const [mayReadKnowledge, mayReadFunding] = await Promise.all([
    identity.can('knowledge.read', organization.id),
    identity.can('funding.read', organization.id),
  ]);
  const shareDocuments = Boolean(organization.consents.documentAnalysisAt);

  const referenceContext: ReferenceContextItem[] = [];
  const tools: ApiTool[] = [];

  if (shareDocuments && mayReadKnowledge) {
    const baseline = await knowledge.baseline(organization);
    referenceContext.push({
      label: 'organization-profile',
      text: profileText(organization, baseline.claims, baseline.approvedAt),
    });

    tools.push({
      name: 'org_get_profile',
      description:
        "Returns the organization's approved profile: each confirmed statement with the document, page or section and wording it rests on. Only approved statements are returned.",
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      execute: async () => {
        try {
          const [current, profile] = await Promise.all([
            knowledge.baseline(organization),
            knowledge.getProfile(organization.id),
          ]);
          return {
            organization: {
              name: organization.name,
              kind: ORGANIZATION_KIND_LABELS[organization.kind],
              location: place(organization),
            },
            approved: current.claims.map((claim) => ({
              part: PROFILE_FIELD_LABELS[claim.field],
              statement: claim.text,
              sources: claim.citations.map((citation) => ({ document: source(citation), wording: citation.quote })),
            })),
            awaitingReview: profile.claims.filter((claim) => claim.status === 'proposed' || claim.status === 'needs_review').length,
            note: 'Statements awaiting review are not part of the profile. Do not treat them as facts.',
          };
        } catch (error) {
          return failure(error);
        }
      },
    });

    tools.push({
      name: 'org_search_knowledge',
      description:
        "Searches the organization's own uploaded documents and returns matching passages word for word, each with its document and page or section. Use a few plain keywords.",
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'A few keywords, for example "job placement results".' },
          limit: { type: 'integer', description: `How many passages to return, at most ${MAX_PASSAGES}.` },
        },
        required: ['query'],
        additionalProperties: false,
      },
      execute: async (args) => {
        try {
          const query = typeof args.query === 'string' ? args.query.slice(0, 300) : '';
          const limit = typeof args.limit === 'number' ? Math.max(1, Math.min(MAX_PASSAGES, Math.floor(args.limit))) : 6;
          const passages = await knowledge.search(organization.id, query, limit);
          return {
            passages: passages.map((passage) => ({
              document: passage.documentName,
              where: passage.page !== null ? `p. ${passage.page}` : passage.section,
              text: passage.text,
            })),
            note: passages.length === 0 ? "Nothing in the organization's documents matched. Say so rather than guessing." : '',
          };
        } catch (error) {
          return failure(error);
        }
      },
    });
  } else if (!shareDocuments) {
    notes.push(NOT_SHARED);
  }

  const focusRfpId = input.focusRfpId;
  if (focusRfpId && shareDocuments && mayReadFunding) {
    // The document the user has open in RFP Analysis. Missing or unread: nothing is added.
    const document = await rfps.source(organization.id, focusRfpId).catch(() => null);
    if (document) {
      const analysis = await rfps.analysis(organization.id, focusRfpId).catch(() => null);
      const summary = analysis ? analysisText(analysis) : '';
      referenceContext.push({
        label: 'funding-document',
        text: [documentText(document.name, document.blocks), summary].filter(Boolean).join('\n\n'),
      });
      notes.push(
        'The funding document the user has open in RFP Analysis is supplied as reference material. It is kept apart from the organization\'s own profile: nothing in it describes the organization.',
      );
    }
  }

  if (mayReadFunding) {
    const allowed = () => Boolean(organization.consents.liveFundingSearchAt);

    tools.push({
      name: 'funding_search_opportunities',
      description:
        'Searches official funding sources (federal, state, city, county and international) and returns listings with the status the app worked out for each (Active, Expired or Unverified) and the reason. ' +
        'Repeat each status exactly as returned. Every keyword in `query` must appear in a listing, so use one to three plain words. The organization\'s place is applied for you.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'One to three keywords, for example "workforce training".' },
          levels: { type: 'array', items: { type: 'string', enum: Object.keys(GEO_LEVEL_LABELS) } },
          categories: { type: 'array', items: { type: 'string', enum: Object.keys(FUNDING_CATEGORY_LABELS) } },
          applicantTypes: { type: 'array', items: { type: 'string', enum: Object.keys(APPLICANT_TYPE_LABELS) } },
          statuses: {
            type: 'array',
            items: { type: 'string', enum: Object.keys(OPPORTUNITY_STATUS_LABELS) },
            description: 'Defaults to active only.',
          },
          amountMin: { type: 'number' },
          amountMax: { type: 'number' },
          deadlineFrom: { type: 'string', description: 'YYYY-MM-DD' },
          deadlineTo: { type: 'string', description: 'YYYY-MM-DD' },
        },
        additionalProperties: false,
      },
      execute: async (args) => {
        if (!allowed()) return { error: SEARCH_NOT_ALLOWED };
        try {
          const filters = readFilters({
            ...DEFAULT_OPPORTUNITY_FILTERS,
            query: typeof args.query === 'string' ? args.query.slice(0, 200) : '',
            levels: stringList(args.levels),
            categories: stringList(args.categories),
            applicantTypes: stringList(args.applicantTypes),
            ...(Array.isArray(args.statuses) && args.statuses.length > 0 ? { statuses: stringList(args.statuses) } : {}),
            amountMin: typeof args.amountMin === 'number' ? args.amountMin : null,
            amountMax: typeof args.amountMax === 'number' ? args.amountMax : null,
            deadlineFrom: typeof args.deadlineFrom === 'string' ? args.deadlineFrom : null,
            deadlineTo: typeof args.deadlineTo === 'string' ? args.deadlineTo : null,
            place: organization.location,
          });
          const result = await opportunities.search({
            filters,
            organization: organization.location,
            profileTerms: mayReadKnowledge ? await knowledge.profileTerms(organization.id) : [],
            signal: input.signal,
          });
          return {
            listings: result.opportunities.slice(0, MAX_LISTINGS).map(listing),
            found: result.opportunities.length,
            shown: Math.min(result.opportunities.length, MAX_LISTINGS),
            sources: result.reports.map((report) => ({
              source: report.sourceName,
              state: report.state,
              matched: report.matched,
              message: report.message,
            })),
            note: 'These came from the official sources named, read just now. A source marked failed could not be read, so the list may be incomplete: say so. Never describe a listing as open unless its status is Active.',
          };
        } catch (error) {
          return failure(error);
        }
      },
    });

    tools.push({
      name: 'funding_get_opportunity',
      description:
        'Re-reads one listing from its official source by the id that funding_search_opportunities returned, with its fuller description, the facts the source states and its official links.',
      inputSchema: {
        type: 'object',
        properties: { id: { type: 'string', description: 'The listing id, for example "grants-gov:355824".' } },
        required: ['id'],
        additionalProperties: false,
      },
      execute: async (args) => {
        if (!allowed()) return { error: SEARCH_NOT_ALLOWED };
        try {
          const detail = await opportunities.detail(assertOpportunityId(args.id), input.signal);
          return {
            listing: listing(detail.opportunity),
            description: detail.description.slice(0, MAX_DESCRIPTION_CHARS),
            facts: detail.facts.slice(0, 60),
            links: detail.links.slice(0, 20),
          };
        } catch (error) {
          return failure(error);
        }
      },
    });
  }

  return { organizationId: organization.id, referenceContext, tools, systemNote: notes.join('\n') };
}
