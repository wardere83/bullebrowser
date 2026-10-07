import { describe, expect, it, vi } from 'vitest';
import type { Organization, ProfileClaim } from '../../shared/funding.js';

vi.mock('electron', () => ({ app: { getPath: () => '/nonexistent' } }));

const { groundChat } = await import('./grounding.js');
type Sources = NonNullable<Parameters<typeof groundChat>[0]>;

const ORG = '11111111-1111-4111-8111-111111111111';
const RFP = '33333333-3333-4333-8333-333333333333';
const NOW = Date.UTC(2026, 9, 6, 12);

const organization = (consents: Partial<Organization['consents']> = {}): Organization => ({
  schemaVersion: 1,
  id: ORG,
  name: 'Harbor Lantern Collective',
  kind: 'cbo',
  location: { country: 'US', region: 'NJ', county: 'Essex', city: 'Newark' },
  consents: { documentAnalysisAt: null, liveFundingSearchAt: null, ...consents },
  createdAt: 1,
  updatedAt: 1,
});

const claim: ProfileClaim = {
  id: 'c1',
  field: 'mission',
  text: 'Opens paths to steady work for East Ward residents.',
  origin: 'extracted',
  status: 'approved',
  citations: [
    {
      documentId: 'd1',
      documentName: 'strategic-plan-2025-2028.pdf',
      documentVersion: 1,
      blockId: 'b0004',
      page: 2,
      section: 'Mission',
      quote: 'Our mission is to open paths to steady work for East Ward residents.',
      match: 'exact',
    },
  ],
  reviewReason: null,
  reviewNote: '',
  supersedesClaimId: null,
  edited: false,
  createdAt: 1,
  updatedAt: 1,
  approvedAt: 2,
  approvedBy: 'u',
};

function sources() {
  return {
    knowledge: {
      baseline: vi.fn(async (active: Organization) => ({
        organizationId: active.id,
        organization: { name: active.name, kind: active.kind, location: active.location },
        claims: [claim],
        approvedAt: Date.UTC(2026, 8, 1),
      })),
      getProfile: vi.fn(async () => ({ claims: [claim, { ...claim, id: 'c2', status: 'proposed' }] })),
      search: vi.fn(async () => [
        {
          documentId: 'd1',
          documentName: 'impact-report-2024.txt',
          documentVersion: 1,
          category: 'impact_report',
          blockIds: ['b0002'],
          page: null,
          section: 'Results',
          text: '212 residents completed training in 2024.',
          score: 3,
        },
      ]),
      profileTerms: vi.fn(async () => [{ term: 'training', field: 'programs' }]),
    },
    rfps: {
      source: vi.fn(async () => ({
        id: RFP,
        name: 'nofa.pdf',
        version: 1,
        label: 'Funding document',
        blocks: [{ id: 'b0001', kind: 'paragraph', text: 'Awards range from $75,000 to $250,000.', page: 3, section: '', headingLevel: null }],
      })),
      analysis: vi.fn(async () => null),
    },
    opportunities: {
      search: vi.fn(async () => ({ opportunities: [], reports: [], truncated: false, searchedAt: NOW })),
      detail: vi.fn(),
    },
  };
}

const identity = (active: Organization | null, allowed: (permission: string) => boolean = () => true) => ({
  requireOrganization: async () => {
    if (!active) throw new Error('none');
    return { session: {} as never, organization: active };
  },
  can: async (permission: string) => allowed(permission),
});

const ground = (
  parts: ReturnType<typeof sources> | null,
  who: ReturnType<typeof identity>,
  focusRfpId?: string,
) =>
  groundChat(parts as unknown as Sources, who as never, {
    ...(focusRfpId ? { focusRfpId } : {}),
    signal: new AbortController().signal,
    now: NOW,
  });

const tool = (grounding: Awaited<ReturnType<typeof ground>>, name: string) => {
  const found = grounding.tools.find((item) => item.name === name);
  if (!found) throw new Error(`no tool ${name}`);
  return found;
};

describe('grounding a chat in the active organization', () => {
  it('states the date and nothing else when no organization is set up', async () => {
    const grounding = await ground(sources(), identity(null));
    expect(grounding.organizationId).toBeNull();
    expect(grounding.referenceContext).toEqual([]);
    expect(grounding.tools).toEqual([]);
    expect(grounding.systemNote).toContain('2026-10-06');
    expect(grounding.systemNote).toContain('No organization is set up');
  });

  it("shares nothing from the organization's documents until that has been agreed to", async () => {
    const parts = sources();
    const grounding = await ground(parts, identity(organization()), RFP);
    expect(grounding.organizationId).toBe(ORG);
    expect(grounding.referenceContext).toEqual([]);
    expect(grounding.tools.map((item) => item.name)).toEqual(['funding_search_opportunities', 'funding_get_opportunity']);
    expect(grounding.systemNote).toContain('not shared with you');
    expect(parts.knowledge.baseline).not.toHaveBeenCalled();
    expect(parts.rfps.source).not.toHaveBeenCalled();
  });

  it('supplies the approved profile, with its sources, as reference material', async () => {
    const grounding = await ground(sources(), identity(organization({ documentAnalysisAt: 5 })));
    const profile = grounding.referenceContext.find((item) => item.label === 'organization-profile');
    expect(profile?.text).toContain('Harbor Lantern Collective (CBO)');
    expect(profile?.text).toContain('Opens paths to steady work for East Ward residents. [source: strategic-plan-2025-2028.pdf, p. 2]');
    expect(profile?.text).toContain('last approved 2026-09-01');
    // Nothing from a document reaches the trusted note.
    expect(grounding.systemNote).not.toContain('Harbor Lantern');
    expect(grounding.systemNote).not.toContain('steady work');
  });

  it('returns approved statements only from the profile tool, and counts what awaits review', async () => {
    const grounding = await ground(sources(), identity(organization({ documentAnalysisAt: 5 })));
    const result = (await tool(grounding, 'org_get_profile').execute({})) as {
      approved: { statement: string; sources: { document: string; wording: string }[] }[];
      awaitingReview: number;
    };
    expect(result.approved).toHaveLength(1);
    expect(result.approved[0]?.sources[0]).toEqual({
      document: 'strategic-plan-2025-2028.pdf, p. 2',
      wording: 'Our mission is to open paths to steady work for East Ward residents.',
    });
    expect(result.awaitingReview).toBe(1);
  });

  it("searches only the active organization's documents", async () => {
    const parts = sources();
    const grounding = await ground(parts, identity(organization({ documentAnalysisAt: 5 })));
    const result = (await tool(grounding, 'org_search_knowledge').execute({ query: 'training results', limit: 99 })) as {
      passages: { document: string; where: string; text: string }[];
    };
    expect(parts.knowledge.search).toHaveBeenCalledWith(ORG, 'training results', 10);
    expect(result.passages[0]).toEqual({
      document: 'impact-report-2024.txt',
      where: 'Results',
      text: '212 residents completed training in 2024.',
    });
  });

  it('adds the open funding document, kept apart from the profile', async () => {
    const grounding = await ground(sources(), identity(organization({ documentAnalysisAt: 5 })), RFP);
    const document = grounding.referenceContext.find((item) => item.label === 'funding-document');
    expect(document?.text).toContain('[p. 3] Awards range from $75,000 to $250,000.');
    expect(grounding.systemNote).toContain('kept apart');
    expect(grounding.referenceContext.find((item) => item.label === 'organization-profile')?.text).not.toContain('$75,000');
  });

  it('will not search official sources until that has been agreed to', async () => {
    const parts = sources();
    const grounding = await ground(parts, identity(organization({ documentAnalysisAt: 5 })));
    const result = (await tool(grounding, 'funding_search_opportunities').execute({ query: 'workforce' })) as { error: string };
    expect(result.error).toContain('not turned on');
    expect(parts.opportunities.search).not.toHaveBeenCalled();
  });

  it("searches with the organization's place and active listings by default", async () => {
    const parts = sources();
    const grounding = await ground(parts, identity(organization({ documentAnalysisAt: 5, liveFundingSearchAt: 6 })));
    await tool(grounding, 'funding_search_opportunities').execute({ query: 'workforce', levels: ['federal'] });
    expect(parts.opportunities.search).toHaveBeenCalledWith(
      expect.objectContaining({
        filters: expect.objectContaining({
          query: 'workforce',
          levels: ['federal'],
          statuses: ['active'],
          place: { country: 'US', region: 'NJ', county: 'Essex', city: 'Newark' },
        }),
        organization: { country: 'US', region: 'NJ', county: 'Essex', city: 'Newark' },
        profileTerms: [{ term: 'training', field: 'programs' }],
      }),
    );
  });

  it('answers a bad request with a message instead of throwing', async () => {
    const grounding = await ground(sources(), identity(organization({ liveFundingSearchAt: 6 })));
    const search = (await tool(grounding, 'funding_search_opportunities').execute({ levels: ['galactic'] })) as { error: string };
    expect(typeof search.error).toBe('string');
    const detail = (await tool(grounding, 'funding_get_opportunity').execute({ id: 'not an id' })) as { error: string };
    expect(typeof detail.error).toBe('string');
  });

  it('offers only what the role allows', async () => {
    const consents = { documentAnalysisAt: 5, liveFundingSearchAt: 6 };
    const noKnowledge = await ground(sources(), identity(organization(consents), (permission) => permission !== 'knowledge.read'));
    expect(noKnowledge.tools.map((item) => item.name)).toEqual(['funding_search_opportunities', 'funding_get_opportunity']);
    expect(noKnowledge.referenceContext).toEqual([]);
    const noFunding = await ground(sources(), identity(organization(consents), (permission) => permission !== 'funding.read'), RFP);
    expect(noFunding.tools.map((item) => item.name)).toEqual(['org_get_profile', 'org_search_knowledge']);
    expect(noFunding.referenceContext.map((item) => item.label)).toEqual(['organization-profile']);
  });
});
