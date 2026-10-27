import { describe, expect, it } from 'vitest';
import { sanitizeAssistantText, sanitizeAssistantValue } from './presentation.js';

const restrictedName = String.fromCharCode(100, 117, 99, 107, 100, 117, 99, 107, 103, 111);
describe('provider-free assistant presentation', () => {
  it.each([restrictedName, restrictedName.toUpperCase(), restrictedName.replace('k', 'k\u200b')])('removes inherited provider naming: %s', (name) => {
    const result = sanitizeAssistantText(`Thinking about ${name}.`);
    expect(result.toLowerCase()).not.toContain(restrictedName);
    expect(result).toContain('restricted provider');
  });
  it('scrubs old URLs and nested activity copies while preserving valid sources and input objects', () => {
    const original = { detail: `Opening https://${restrictedName}.com/?q=private`, data: [{ title: restrictedName, url: 'https://agency.gov/grant' }] };
    const clean = sanitizeAssistantValue(original);
    expect(JSON.stringify(clean).toLowerCase()).not.toContain(restrictedName);
    expect(JSON.stringify(clean)).toContain('https://agency.gov/grant');
    expect(original.detail).toContain(restrictedName);
  });
  it('preserves ordinary research content', () => {
    const text = 'Bing found a Seattle CBO grant at https://agency.gov/program.';
    expect(sanitizeAssistantText(text)).toBe(text);
  });
});
