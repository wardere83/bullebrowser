import { expect, it } from 'vitest';
import { ElementMapCache } from './element-cache.js';
it('expires after two seconds and isolates tabs, URLs and queries', () => {
  let now = 0;
  const cache = new ElementMapCache<{ elements: string[] }>(() => now);
  cache.set('tab', 'https://agency.gov', '', { elements: ['@12 Apply'] });
  expect(cache.get('tab', 'https://agency.gov')).toEqual({ elements: ['@12 Apply'] });
  expect(cache.get('other', 'https://agency.gov')).toBeUndefined();
  expect(cache.get('tab', 'https://agency.gov/next')).toBeUndefined();
  expect(cache.get('tab', 'https://agency.gov', 'form')).toBeUndefined();
  cache.get('tab', 'https://agency.gov')!.elements.push('changed');
  expect(cache.get('tab', 'https://agency.gov')!.elements).toHaveLength(1);
  now = 2000;
  expect(cache.get('tab', 'https://agency.gov')).toBeUndefined();
  cache.set('tab', 'https://agency.gov', '', { elements: [] });
  cache.invalidate('tab');
  expect(cache.get('tab', 'https://agency.gov')).toBeUndefined();
});
