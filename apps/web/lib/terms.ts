// Names the desktop app shows on screen. The app's interface is in English, so
// the site prints these exactly as the app does in every language and lets the
// translated copy around them say what they mean. They are kept out of the
// dictionaries for that reason: a translated name would point visitors at a
// button that does not exist.

/** The four options under "What can I help you with?", in the app's order. */
export const WORKFLOWS = [
  { id: 'find', label: 'Find Relevant Grant Opportunities' },
  { id: 'align', label: 'Assess Your Funding Alignment' },
  { id: 'priorities', label: 'Explore Funder Priorities' },
  { id: 'guide', label: 'Ethical Strengths-Based Proposal Guide' },
] as const;

export type WorkflowId = (typeof WORKFLOWS)[number]['id'];

export const KNOWLEDGE_HUB = 'Organization Knowledge Hub';
/** The guide has a section of its own on the site, under the option's name. */
export const PROPOSAL_GUIDE = WORKFLOWS[3].label;
export const ASSISTANT_NAME = 'BulleBrowser Agentic AI';

/** Screens of the app's workspace, as its navigation names them. */
export const SCREENS = {
  opportunities: 'Opportunities',
  rfpAnalysis: 'RFP Analysis',
} as const;

export const OPPORTUNITY_STATUSES = ['active', 'expired', 'unverified'] as const;
export type OpportunityStatus = (typeof OPPORTUNITY_STATUSES)[number];

export const GEO_LEVELS = ['city', 'county', 'state', 'federal', 'international'] as const;
export type GeoLevel = (typeof GEO_LEVELS)[number];

/**
 * The official sources the app reads when you search, and nothing more: a
 * source belongs here only once the app really queries it. `about` picks the
 * translated line saying what the source lists.
 */
export const LIVE_SOURCES = [
  { id: 'grants-gov', name: 'Grants.gov', level: 'federal', about: 'grants' },
  { id: 'california', name: 'California Grants Portal', level: 'state', about: 'california' },
  { id: 'nyc', name: 'New York City', level: 'city', about: 'local' },
  { id: 'los-angeles', name: 'Los Angeles', level: 'city', about: 'local' },
  { id: 'montgomery', name: 'Montgomery County, Maryland', level: 'county', about: 'local' },
  { id: 'eu', name: 'EU Funding & Tenders Portal', level: 'international', about: 'eu' },
] as const satisfies readonly { id: string; name: string; level: GeoLevel; about: string }[];
