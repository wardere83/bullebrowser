// Search filters to start from, drawn from what is already known about an
// organization: where it is, what kind it is, and what its approved profile
// plainly says it works on.
//
// These are suggestions for a person to change, so each one comes with the
// reason for it in words. A category is suggested only when an approved
// statement names it in so many words. A statement that merely could relate
// to a category suggests nothing: leaving a category out costs a person one
// click, while a wrong one hides listings they wanted to see.

import {
  DEFAULT_OPPORTUNITY_FILTERS,
  FUNDING_CATEGORY_LABELS,
  type ApplicantType,
  type FundingCategory,
  type OpportunityFilters,
  type Organization,
  type OrganizationKind,
  type PlaceFilter,
  type ProfileClaim,
  type ProfileFieldId,
} from '../../shared/funding.js';
import { queryTerms } from '../opportunities/normalize.js';

export interface SuggestedFilters {
  filters: OpportunityFilters;
  /** What each suggestion rests on, in words. */
  basis: string[];
}

const APPLICANTS: Record<OrganizationKind, { types: ApplicantType[]; words: string }> = {
  cbo: { types: ['nonprofit'], words: 'CBOs and other nonprofits' },
  business: { types: ['small_business', 'for_profit'], words: 'small businesses and other businesses' },
};

// The parts of a profile that say what an organization does and wants funded,
// most telling first, with the word used for one statement of each. The other
// parts (who is served, where, how well) mention many subjects in passing.
const TELLING_FIELDS: [field: ProfileFieldId, statement: string][] = [
  ['strategic_priorities', 'priority'],
  ['funding_goals', 'funding goal'],
  ['mission', 'mission statement'],
  ['programs', 'program description'],
];

// Wording that names a funding category outright, most specific first. Written
// as a record so that a category added to the contract and not listed here
// fails the type check. Words with a second, unrelated meaning are left out on
// their own ("health" in "financial health", "arts" in "state of the art").
const CATEGORY_WORDING: Record<Exclude<FundingCategory, 'other'>, string[]> = {
  agriculture_food: [
    'food security',
    'food access',
    'food bank',
    'food pantry',
    'agriculture',
    'farming',
    'farmers',
    'nutrition',
  ],
  arts_culture_humanities: [
    'arts education',
    'performing arts',
    'visual arts',
    'arts and culture',
    'museum',
    'theater',
    'theatre',
    'humanities',
  ],
  business_economic_development: [
    'small business',
    'economic development',
    'business development',
    'entrepreneurship',
    'entrepreneurs',
  ],
  community_development: ['community development', 'neighborhood revitalization', 'community facilities'],
  disaster_emergency: [
    'disaster relief',
    'disaster recovery',
    'disaster preparedness',
    'emergency preparedness',
    'emergency response',
  ],
  education: [
    'adult education',
    'high school equivalency',
    'english classes',
    'literacy',
    'tutoring',
    'scholarships',
    'education',
  ],
  employment_workforce: [
    'workforce training',
    'workforce development',
    'job training',
    'job placement',
    'job readiness',
    'employment services',
    'apprenticeship',
    'apprentices',
    'workforce',
  ],
  energy: ['energy efficiency', 'renewable energy', 'clean energy', 'weatherization', 'electrification', 'solar'],
  environment_natural_resources: [
    'environmental justice',
    'environmental education',
    'environmental protection',
    'climate resilience',
    'climate change',
    'water quality',
    'air quality',
    'natural resources',
    'conservation',
    'recycling',
  ],
  health: [
    'health care',
    'healthcare',
    'mental health',
    'public health',
    'behavioral health',
    'community health',
    'health services',
    'health clinic',
    'health education',
    'substance use',
  ],
  housing: ['affordable housing', 'homeownership', 'homelessness', 'homeless', 'tenants', 'housing'],
  human_services: ['human services', 'social services', 'case management', 'senior services', 'emergency assistance'],
  justice_public_safety: [
    'public safety',
    'violence prevention',
    'juvenile justice',
    'legal aid',
    'legal services',
    'reentry',
    're-entry',
  ],
  science_technology_research: ['scientific research', 'research and development', 'broadband'],
  transportation_infrastructure: [
    'public transportation',
    'public transit',
    'transportation services',
    'roads and bridges',
  ],
};

/** Folds simple plurals so "apprenticeships" meets "apprenticeship". Applied to both sides alike. */
function singular(word: string): string {
  if (word.length < 5) return word;
  if (word.endsWith('ies')) return `${word.slice(0, -3)}y`;
  if (/(?:ss|x|ch|sh)es$/.test(word)) return word.slice(0, -2);
  return word.endsWith('s') && !/(?:ss|us|is)$/.test(word) ? word.slice(0, -1) : word;
}

// Padded so that wording only matches whole words, never part of one.
const padded = (text: string): string => ` ${queryTerms(text).map(singular).join(' ')} `;

const CATEGORIES = (Object.keys(CATEGORY_WORDING) as (keyof typeof CATEGORY_WORDING)[]).map((category) => ({
  category,
  wording: CATEGORY_WORDING[category].map((phrase) => ({ phrase, key: padded(phrase) })),
}));

/** A place the way people write one: "Newark, NJ". Empty when nothing is known. */
function placeLabel(place: PlaceFilter): string {
  const named = [place.city || place.county, place.region].filter(Boolean);
  return named.length > 0 ? named.join(', ') : place.country;
}

const clean = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

/**
 * Filters for a first search. Place and applicant types come from the
 * organization's own details. Categories come from approved statements only,
 * and from none of them until the profile has been approved.
 */
export function suggestFiltersFor(organization: Organization, claims: ProfileClaim[]): SuggestedFilters {
  const place: PlaceFilter = {
    country: clean(organization.location?.country),
    region: clean(organization.location?.region),
    county: clean(organization.location?.county),
    city: clean(organization.location?.city),
  };
  const applicants = APPLICANTS[organization.kind] ?? { types: [], words: '' };
  const where = placeLabel(place);
  const basis: string[] = [
    where
      ? `Place: ${where}, from your organization details`
      : 'Place: none, because your organization details do not say where you are',
  ];
  if (applicants.types.length > 0) {
    basis.push(`Applicant types: ${applicants.words}, from your organization type`);
  }

  const approved = claims.filter((claim) => claim.status === 'approved');
  const statements = TELLING_FIELDS.flatMap(([field, statement]) =>
    approved.filter((claim) => claim.field === field).map((claim) => ({ statement, key: padded(claim.text) })),
  );
  const categories: FundingCategory[] = [];
  for (const { category, wording } of CATEGORIES) {
    for (const { statement, key } of statements) {
      const named = wording.find((entry) => key.includes(entry.key));
      if (!named) continue;
      categories.push(category);
      basis.push(
        `Category "${FUNDING_CATEGORY_LABELS[category]}": from your approved ${statement} that mentions ${named.phrase}`,
      );
      break;
    }
  }
  if (approved.length === 0) {
    basis.push('Categories: none suggested, because your profile is not approved yet');
  } else if (categories.length === 0) {
    basis.push('Categories: none suggested, because your approved statements do not plainly name a funding category');
  }

  return {
    filters: {
      ...structuredClone(DEFAULT_OPPORTUNITY_FILTERS),
      query: '',
      place,
      applicantTypes: [...applicants.types],
      categories,
    },
    basis,
  };
}
