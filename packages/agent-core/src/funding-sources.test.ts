import { expect, it } from 'vitest';
import { GRANT_SEARCH_SERVICES, fundingSearchQuery, isFundingDiscoveryRequest, isGrantSearchService } from './funding-sources.js';

it.each(GRANT_SEARCH_SERVICES)('excludes %s and its subdomains, but not lookalikes', (host) => {
  expect(isGrantSearchService(`https://${host}/grants`)).toBe(true);
  expect(isGrantSearchService(`https://www.${host.toUpperCase()}./grants`)).toBe(true);
  expect(isGrantSearchService(`https://app.${host}/`)).toBe(true);
  expect(isGrantSearchService(`https://${host}.foundation.org/`)).toBe(false);
  expect(isGrantSearchService(`https://foundation.org/${host}`)).toBe(false);
});

it('does not exclude official funders, government listings or application portals', () => {
  for (const url of ['https://grants.gov', 'https://grants.ca.gov', 'https://foundation.org/grants', 'https://foundation.submittable.com/submit']) {
    expect(isGrantSearchService(url)).toBe(false);
  }
  expect(isGrantSearchService('not a URL')).toBe(false);
});

it('scopes source exclusions to funding, not ordinary software comparisons', () => {
  expect(isFundingDiscoveryRequest('Find workforce grants in California')).toBe(true);
  expect(isFundingDiscoveryRequest('Compare grants for youth programs')).toBe(true);
  expect(isFundingDiscoveryRequest('Compare grant search software')).toBe(false);
  expect(fundingSearchQuery('California youth', true)).toContain('-site:grantable.co');
  expect(fundingSearchQuery('Compare software', false)).toBe('Compare software');
});
