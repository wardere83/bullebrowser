// The logic behind the organization form, kept apart from the form itself so
// it can be tested: the places an organization can be based, checking what was
// typed, and matching what main says is wrong to the field it is about.

import {
  ORGANIZATION_KIND_LABELS,
  type NewOrganizationInput,
  type OrgLocation,
  type OrgRole,
  type Organization,
  type OrganizationKind,
} from '../../shared/funding.js';

// ─────────────────────────────────── places ───────────────────────────────────

/** ISO 3166-1 alpha-2 codes. Names come from the platform, so none are typed here. */
const COUNTRY_CODES =
  'AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ ' +
  'CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR ' +
  'GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP ' +
  'KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT ' +
  'MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW ' +
  'SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ ' +
  'UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW';

export const DEFAULT_COUNTRY = 'US';

export interface PlaceOption {
  code: string;
  name: string;
}

let countries: PlaceOption[] | null = null;

/** Every country, by name. Built once. */
export function countryOptions(): PlaceOption[] {
  if (countries) return countries;
  let names: Intl.DisplayNames | null = null;
  try {
    names = new Intl.DisplayNames(['en'], { type: 'region' });
  } catch {
    // Without the platform's names the codes are still a usable list.
  }
  countries = COUNTRY_CODES.split(' ')
    .map((code) => ({ code, name: names?.of(code) ?? code }))
    .sort((a, b) => a.name.localeCompare(b.name, 'en'));
  return countries;
}

/** A country's name, or the code itself when it is not one the list knows. */
export function countryName(code: string): string {
  return countryOptions().find((country) => country.code === code)?.name ?? code;
}

/** States, the federal district and territories of the United States, by postal abbreviation. */
export const US_REGIONS: readonly PlaceOption[] = [
  { code: 'AL', name: 'Alabama' },
  { code: 'AK', name: 'Alaska' },
  { code: 'AS', name: 'American Samoa' },
  { code: 'AZ', name: 'Arizona' },
  { code: 'AR', name: 'Arkansas' },
  { code: 'CA', name: 'California' },
  { code: 'CO', name: 'Colorado' },
  { code: 'CT', name: 'Connecticut' },
  { code: 'DE', name: 'Delaware' },
  { code: 'DC', name: 'District of Columbia' },
  { code: 'FL', name: 'Florida' },
  { code: 'GA', name: 'Georgia' },
  { code: 'GU', name: 'Guam' },
  { code: 'HI', name: 'Hawaii' },
  { code: 'ID', name: 'Idaho' },
  { code: 'IL', name: 'Illinois' },
  { code: 'IN', name: 'Indiana' },
  { code: 'IA', name: 'Iowa' },
  { code: 'KS', name: 'Kansas' },
  { code: 'KY', name: 'Kentucky' },
  { code: 'LA', name: 'Louisiana' },
  { code: 'ME', name: 'Maine' },
  { code: 'MD', name: 'Maryland' },
  { code: 'MA', name: 'Massachusetts' },
  { code: 'MI', name: 'Michigan' },
  { code: 'MN', name: 'Minnesota' },
  { code: 'MS', name: 'Mississippi' },
  { code: 'MO', name: 'Missouri' },
  { code: 'MT', name: 'Montana' },
  { code: 'NE', name: 'Nebraska' },
  { code: 'NV', name: 'Nevada' },
  { code: 'NH', name: 'New Hampshire' },
  { code: 'NJ', name: 'New Jersey' },
  { code: 'NM', name: 'New Mexico' },
  { code: 'NY', name: 'New York' },
  { code: 'NC', name: 'North Carolina' },
  { code: 'ND', name: 'North Dakota' },
  { code: 'MP', name: 'Northern Mariana Islands' },
  { code: 'OH', name: 'Ohio' },
  { code: 'OK', name: 'Oklahoma' },
  { code: 'OR', name: 'Oregon' },
  { code: 'PA', name: 'Pennsylvania' },
  { code: 'PR', name: 'Puerto Rico' },
  { code: 'RI', name: 'Rhode Island' },
  { code: 'SC', name: 'South Carolina' },
  { code: 'SD', name: 'South Dakota' },
  { code: 'TN', name: 'Tennessee' },
  { code: 'TX', name: 'Texas' },
  { code: 'UT', name: 'Utah' },
  { code: 'VT', name: 'Vermont' },
  { code: 'VI', name: 'U.S. Virgin Islands' },
  { code: 'VA', name: 'Virginia' },
  { code: 'WA', name: 'Washington' },
  { code: 'WV', name: 'West Virginia' },
  { code: 'WI', name: 'Wisconsin' },
  { code: 'WY', name: 'Wyoming' },
];

/** Whether the app offers a list of regions for a country instead of a text field. */
export function hasRegionList(country: string): boolean {
  return country === 'US';
}

/** A location in one line, most specific part first, leaving out what is empty. */
export function describeLocation(location: OrgLocation): string {
  const region =
    location.country === 'US'
      ? (US_REGIONS.find((entry) => entry.code === location.region)?.name ?? location.region)
      : location.region;
  return [
    location.city,
    location.county,
    region,
    location.country ? countryName(location.country) : '',
  ]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(', ');
}

// ──────────────────────────────────── form ────────────────────────────────────

export type OrganizationField = 'name' | 'kind' | 'country' | 'region' | 'county' | 'city';

export interface OrganizationFormValues {
  name: string;
  /** Null until the person has chosen: there is no default type. */
  kind: OrganizationKind | null;
  country: string;
  region: string;
  county: string;
  city: string;
}

export const EMPTY_ORGANIZATION_VALUES: OrganizationFormValues = {
  name: '',
  kind: null,
  country: DEFAULT_COUNTRY,
  region: '',
  county: '',
  city: '',
};

export function valuesFromOrganization(organization: Organization): OrganizationFormValues {
  return {
    name: organization.name,
    kind: organization.kind,
    country: organization.location.country || DEFAULT_COUNTRY,
    region: organization.location.region,
    county: organization.location.county,
    city: organization.location.city,
  };
}

export type OrganizationFieldErrors = Partial<Record<OrganizationField, string>>;

const tidy = (value: string) => value.replace(/\s+/g, ' ').trim();

/** The longest name the form accepts; main has the final say. */
export const MAX_ORGANIZATION_NAME = 120;

/**
 * Checks what was typed. Returns the input to send, or what is wrong with each
 * field in words that say how to fix it. Main checks again and has the final
 * say; this only saves a round trip for what can be seen from the form.
 */
export function validateOrganization(
  values: OrganizationFormValues,
): { ok: true; input: NewOrganizationInput } | { ok: false; errors: OrganizationFieldErrors } {
  const errors: OrganizationFieldErrors = {};
  const name = tidy(values.name);
  if (!name) errors.name = 'Enter your organization’s name.';
  else if (name.length > MAX_ORGANIZATION_NAME) {
    errors.name = `Use a name of ${MAX_ORGANIZATION_NAME} characters or fewer.`;
  }
  if (!values.kind) {
    errors.kind = `Choose ${ORGANIZATION_KIND_LABELS.business} or ${ORGANIZATION_KIND_LABELS.cbo}.`;
  }
  const country = values.country.trim().toUpperCase();
  if (!country) errors.country = 'Choose a country.';

  if (Object.keys(errors).length > 0 || !values.kind) return { ok: false, errors };
  return {
    ok: true,
    input: {
      name,
      kind: values.kind,
      location: {
        country,
        region: tidy(values.region),
        county: tidy(values.county),
        city: tidy(values.city),
      },
    },
  };
}

/**
 * The field an "invalid input" message from main is about, or null when the
 * message does not name one (it is then shown above the form instead). Main's
 * errors carry a sentence but no field, so the field is read from the words.
 */
export function fieldForInvalidInput(message: string): OrganizationField | null {
  const text = message.toLowerCase();
  const mentions = (...words: string[]) =>
    words.some((word) => new RegExp(`\\b${word}\\b`).test(text));
  // The location words first: "a city name" is about the city, not the name.
  if (mentions('city', 'town')) return 'city';
  if (mentions('county', 'parish', 'borough')) return 'county';
  if (mentions('state', 'region', 'province', 'territory')) return 'region';
  if (mentions('country')) return 'country';
  // The name before the type: "Type it again without them" is about a name.
  if (mentions('name', 'named')) return 'name';
  if (mentions('business', 'cbo', 'organization type', 'type of organization')) return 'kind';
  return null;
}

/** Only what changed, for an update. Empty when nothing did. */
export function changedOrganizationFields(
  original: Organization,
  input: NewOrganizationInput,
): Partial<NewOrganizationInput> {
  const patch: Partial<NewOrganizationInput> = {};
  if (input.name !== original.name) patch.name = input.name;
  if (input.kind !== original.kind) patch.kind = input.kind;
  const before = original.location;
  const after = input.location;
  if (
    after.country !== before.country ||
    after.region !== before.region ||
    after.county !== before.county ||
    after.city !== before.city
  ) {
    patch.location = after;
  }
  return patch;
}

/**
 * Whether what was typed confirms the deletion of the organization with this
 * name. Capitals and extra spaces are forgiven; anything else is not.
 */
export function confirmsOrganizationName(typed: string, name: string): boolean {
  const expected = tidy(name).toLowerCase();
  return expected.length > 0 && tidy(typed).toLowerCase() === expected;
}

/** What each role is called. The shared contract has no display labels for roles. */
export const ROLE_LABELS: Record<OrgRole, string> = {
  owner: 'Owner',
  admin: 'Admin',
  member: 'Member',
  viewer: 'Viewer',
};
