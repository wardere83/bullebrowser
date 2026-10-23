import { describe, expect, it } from 'vitest';
import { opportunityIdFromLink } from './official-link.js';

describe('official funding links', () => {
  it.each([
    ['https://www.grants.gov/search-results-detail/362880', 'grants-gov:362880'],
    ['https://simpler.grants.gov/opportunity/362880', 'grants-gov:362880'],
    ['https://www.grants.ca.gov/?p=191046', 'ca-grants-portal:191046'],
    ['https://a856-cityrecord.nyc.gov/RequestDetail/1234', 'nyc-city-record:1234'],
  ])('reads %s through its official adapter', (url, id) =>
    expect(opportunityIdFromLink(url)).toBe(id),
  );
  it.each([
    'http://www.grants.gov/search-results-detail/1',
    'https://www.grants.gov.evil.test/search-results-detail/1',
    'https://user:secret@www.grants.gov/search-results-detail/1',
    'https://127.0.0.1/notice',
    'file:///tmp/rfp.pdf',
    'https://www.grants.gov:8000/search-results-detail/1',
  ])('rejects %s without making a request', (url) =>
    expect(() => opportunityIdFromLink(url)).toThrow(),
  );
});
