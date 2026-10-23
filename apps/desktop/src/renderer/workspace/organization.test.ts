import { describe, expect, it } from 'vitest';
import type { Organization } from '../../shared/funding.js';
import { describeActivity } from './activity.js';
import {
  EMPTY_ORGANIZATION_VALUES,
  MAX_ORGANIZATION_NAME,
  US_REGIONS,
  changedOrganizationFields,
  confirmsOrganizationName,
  countryName,
  countryOptions,
  describeLocation,
  fieldForInvalidInput,
  hasRegionList,
  validateOrganization,
  valuesFromOrganization,
} from './organization.js';

const riverbend: Organization = {
  schemaVersion: 1,
  id: 'org-1',
  name: 'Riverbend Kitchen',
  kind: 'cbo',
  location: { country: 'US', region: 'NJ', county: 'Essex', city: 'Newark' },
  consents: { documentAnalysisAt: null, liveFundingSearchAt: null },
  createdAt: 1,
  updatedAt: 1,
};

describe('places', () => {
  it('offers every country once, by name, with the United States as the default', () => {
    const countries = countryOptions();
    expect(countries).toHaveLength(249);
    expect(new Set(countries.map((country) => country.code)).size).toBe(249);
    expect(countries.every((country) => /^[A-Z]{2}$/.test(country.code))).toBe(true);
    expect(countryName('US')).toBe('United States');
    expect(countryName('CA')).toBe('Canada');
    expect(EMPTY_ORGANIZATION_VALUES.country).toBe('US');
    const names = countries.map((country) => country.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, 'en')));
  });

  it('falls back to the code for a country it does not know', () => {
    expect(countryName('ZZ')).toBe('ZZ');
  });

  it('lists the states, the federal district and the territories by postal abbreviation', () => {
    expect(US_REGIONS).toHaveLength(56);
    expect(new Set(US_REGIONS.map((region) => region.code)).size).toBe(56);
    expect(US_REGIONS.find((region) => region.code === 'NJ')?.name).toBe('New Jersey');
    expect(US_REGIONS.find((region) => region.code === 'PR')?.name).toBe('Puerto Rico');
    expect(hasRegionList('US')).toBe(true);
    expect(hasRegionList('CA')).toBe(false);
  });

  it('describes a location in one line and leaves out what is empty', () => {
    expect(describeLocation(riverbend.location)).toBe('Newark, Essex, New Jersey, United States');
    expect(
      describeLocation({ country: 'KE', region: 'Nairobi County', county: '', city: '' }),
    ).toBe('Nairobi County, Kenya');
    expect(describeLocation({ country: '', region: '', county: '', city: '' })).toBe('');
  });
});

describe('validateOrganization', () => {
  it('asks for a name, a type and a country', () => {
    const result = validateOrganization({ ...EMPTY_ORGANIZATION_VALUES, country: '' });
    expect(result).toEqual({
      ok: false,
      errors: {
        name: 'Enter your organization’s name.',
        kind: 'Choose Business or CBO.',
        country: 'Choose a country.',
      },
    });
  });

  it('has no default type: a person must choose', () => {
    expect(EMPTY_ORGANIZATION_VALUES.kind).toBeNull();
    const result = validateOrganization({
      ...EMPTY_ORGANIZATION_VALUES,
      name: 'Riverbend Kitchen',
    });
    expect(result).toMatchObject({ ok: false, errors: { kind: 'Choose Business or CBO.' } });
  });

  it('tidies what was typed before sending it', () => {
    const result = validateOrganization({
      name: '  Riverbend   Kitchen ',
      kind: 'cbo',
      country: 'us',
      region: ' NJ ',
      county: ' Essex ',
      city: '  Newark',
    });
    expect(result).toEqual({
      ok: true,
      input: {
        name: 'Riverbend Kitchen',
        kind: 'cbo',
        location: { country: 'US', region: 'NJ', county: 'Essex', city: 'Newark' },
      },
    });
  });

  it('accepts a location with only a country', () => {
    const result = validateOrganization({
      ...EMPTY_ORGANIZATION_VALUES,
      name: 'Harbor Works',
      kind: 'business',
    });
    expect(result).toMatchObject({
      ok: true,
      input: { location: { country: 'US', region: '', county: '', city: '' } },
    });
  });

  it('refuses a name that is too long', () => {
    const result = validateOrganization({
      ...EMPTY_ORGANIZATION_VALUES,
      kind: 'business',
      name: 'x'.repeat(MAX_ORGANIZATION_NAME + 1),
    });
    expect(result).toMatchObject({
      ok: false,
      errors: { name: 'Use a name of 120 characters or fewer.' },
    });
  });

  it('starts an edit from the organization as it is', () => {
    expect(valuesFromOrganization(riverbend)).toEqual({
      name: 'Riverbend Kitchen',
      kind: 'cbo',
      country: 'US',
      region: 'NJ',
      county: 'Essex',
      city: 'Newark',
    });
  });
});

describe('fieldForInvalidInput', () => {
  it('finds the field a message from main is about', () => {
    expect(fieldForInvalidInput('Enter the organization’s name.')).toBe('name');
    expect(fieldForInvalidInput('An organization with that name already exists.')).toBe('name');
    expect(fieldForInvalidInput('Choose whether the organization is a business or a CBO.')).toBe(
      'kind',
    );
    expect(fieldForInvalidInput('Choose the organization type.')).toBe('kind');
    expect(fieldForInvalidInput('Choose a country from the list.')).toBe('country');
    expect(fieldForInvalidInput('Enter a state or region.')).toBe('region');
    expect(fieldForInvalidInput('That province is not recognized.')).toBe('region');
    expect(fieldForInvalidInput('Enter the county.')).toBe('county');
    expect(fieldForInvalidInput('Enter a city name of 80 characters or fewer.')).toBe('city');
  });

  it('reads the identity service’s own sentences correctly', () => {
    expect(
      fieldForInvalidInput('Enter an organization name between 2 and 120 characters long.'),
    ).toBe('name');
    expect(
      fieldForInvalidInput(
        'The organization name contains characters that cannot be used, such as line breaks. Type it again without them.',
      ),
    ).toBe('name');
    expect(fieldForInvalidInput('Choose whether this organization is a business or a CBO.')).toBe(
      'kind',
    );
    expect(
      fieldForInvalidInput('Enter the country as its two-letter code, such as US or CA.'),
    ).toBe('country');
    expect(fieldForInvalidInput('Keep the state or region to 80 characters or fewer.')).toBe(
      'region',
    );
    expect(
      fieldForInvalidInput(
        'The county contains characters that cannot be used, such as line breaks. Type it again without them.',
      ),
    ).toBe('county');
    expect(fieldForInvalidInput('Keep the city to 80 characters or fewer.')).toBe('city');
  });

  it('does not mistake one word for another', () => {
    // "United States" is not the state field; "county" is not "country".
    expect(fieldForInvalidInput('Organizations in the United States need a county.')).toBe(
      'county',
    );
    expect(fieldForInvalidInput('That country is not supported.')).toBe('country');
  });

  it('returns null when the message names no field', () => {
    expect(fieldForInvalidInput('That request is not recognized.')).toBeNull();
    expect(fieldForInvalidInput('That organization is not valid.')).toBeNull();
    expect(fieldForInvalidInput('')).toBeNull();
  });
});

describe('changedOrganizationFields', () => {
  const unchanged = {
    name: riverbend.name,
    kind: riverbend.kind,
    location: { ...riverbend.location },
  };

  it('is empty when nothing changed', () => {
    expect(changedOrganizationFields(riverbend, unchanged)).toEqual({});
  });

  it('sends only what changed, and the location as a whole', () => {
    expect(
      changedOrganizationFields(riverbend, { ...unchanged, name: 'Riverbend Community Kitchen' }),
    ).toEqual({
      name: 'Riverbend Community Kitchen',
    });
    expect(changedOrganizationFields(riverbend, { ...unchanged, kind: 'business' })).toEqual({
      kind: 'business',
    });
    expect(
      changedOrganizationFields(riverbend, {
        ...unchanged,
        location: { ...riverbend.location, city: 'Montclair' },
      }),
    ).toEqual({ location: { country: 'US', region: 'NJ', county: 'Essex', city: 'Montclair' } });
  });
});

describe('confirmsOrganizationName', () => {
  it('needs the whole name', () => {
    expect(confirmsOrganizationName('Riverbend Kitchen', 'Riverbend Kitchen')).toBe(true);
    expect(confirmsOrganizationName('Riverbend', 'Riverbend Kitchen')).toBe(false);
    expect(confirmsOrganizationName('Riverbend Kitchens', 'Riverbend Kitchen')).toBe(false);
    expect(confirmsOrganizationName('', 'Riverbend Kitchen')).toBe(false);
  });

  it('forgives capitals and stray spaces, and nothing else', () => {
    expect(confirmsOrganizationName('  riverbend   kitchen ', 'Riverbend Kitchen')).toBe(true);
    expect(confirmsOrganizationName('Riverbend-Kitchen', 'Riverbend Kitchen')).toBe(false);
  });

  it('is never satisfied for an organization without a name', () => {
    expect(confirmsOrganizationName('', '')).toBe(false);
    expect(confirmsOrganizationName(' ', '  ')).toBe(false);
  });
});

describe('describeActivity', () => {
  it('says what happened and to what', () => {
    expect(describeActivity({ action: 'document_added', detail: 'Strategic Plan 2026.pdf' })).toBe(
      'Document added: Strategic Plan 2026.pdf',
    );
    expect(describeActivity({ action: 'organization_created', detail: '  ' })).toBe(
      'Organization created',
    );
  });
});
