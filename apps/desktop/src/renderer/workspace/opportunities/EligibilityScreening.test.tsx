import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import type { Opportunity } from '../../../shared/funding.js';
import { EligibilityScreening } from './EligibilityScreening.js';

it('starts unconfirmed, labels both inputs and links the official requirements', () => {
  const opportunity = { id: 'sample', applicantTypes: ['nonprofit'], awardFloor: 1000, awardCeiling: 5000, currency: 'USD', officialUrl: 'https://grants.gov/search-results-detail/1', applicantNote: '<script>untrusted</script>', geographyNote: '' } as Opportunity;
  const html = renderToStaticMarkup(<EligibilityScreening opportunity={opportunity} />);
  expect(html).toContain('Not confirmed');
  expect(html).toContain('do not establish full eligibility');
  expect(html.match(/Needs review/g)).toHaveLength(3);
  expect(html.match(/<label /g)).toHaveLength(2);
  expect(html).toContain('https://grants.gov/search-results-detail/1');
  expect(html).not.toContain('<script>');
  expect(html).toContain('&lt;script&gt;');
});
