import { describe, expect, it } from 'vitest';
import { addressDestination } from './address';

describe('address bar destinations', () => {
  it('opens hosts, including ones with a port, over HTTPS', () => {
    expect(addressDestination('example.com')).toBe('https://example.com/');
    expect(addressDestination(' grants.gov/search ')).toBe('https://grants.gov/search');
    expect(addressDestination('example.com:8443')).toBe('https://example.com:8443/');
    expect(addressDestination('example.com:8443/path?q=1')).toBe('https://example.com:8443/path?q=1');
    expect(addressDestination('example.com?q=1')).toBe('https://example.com/?q=1');
  });
  it('keeps HTTPS addresses and searches everything else', () => {
    expect(addressDestination('https://example.com/a')).toBe('https://example.com/a');
    expect(addressDestination('grants for youth programs')).toBe(
      'https://www.google.com/search?q=grants%20for%20youth%20programs',
    );
  });
  it('refuses other schemes and embedded credentials', () => {
    for (const value of ['http://example.com', 'javascript:alert(1)', 'file:///etc/hosts', 'https://user:pw@example.com'])
      expect(() => addressDestination(value)).toThrow('Enter an HTTPS website or a search.');
  });
});
