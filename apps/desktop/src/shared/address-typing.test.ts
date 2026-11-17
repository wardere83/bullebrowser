import { expect, it } from 'vitest';
import { addressText, typingDuration } from './address-typing.js';

it('types a URL the way a person would', () => {
  expect(addressText('https://www.njeda.gov/')).toBe('www.njeda.gov');
  expect(addressText('https://www.njeda.gov/activeprograms/')).toBe('www.njeda.gov/activeprograms');
  expect(addressText('http://127.0.0.1:4000/program/youth?x=1')).toBe('127.0.0.1:4000/program/youth?x=1');
});

it('keeps typing between a third of a second and 1.2 seconds', () => {
  expect(typingDuration('a.gov')).toBe(350);
  expect(typingDuration('www.njeda.gov')).toBe(13 * 35);
  expect(typingDuration('x'.repeat(200))).toBe(1200);
});
