import { describe, expect, it } from 'vitest';
import { speechChunks, speechText } from './speech.js';

describe('spoken replies', () => {
  it('speaks readable link labels and contact details without Markdown or URLs', () => {
    expect(speechText("I'm the **BulleBrowser Agentic AI**. Contact [support@bullebrowser.com](mailto:support@bullebrowser.com).\n\nRead [the report](https://example.com/report_(2026)) [1]."))
      .toBe("I'm the BulleBrowser Agentic AI. Contact support at bullebrowser dot com. Read the report.");
  });
  it('leaves code in chat and handles unfinished fences and raw web addresses', () => {
    const text = speechText('## Result\n- First result\n```js\nconst key = "private";\n```\nVisit https://example.com/docs\nMore detail.\n~~~\ncode');
    expect(text).toContain('First result');
    expect(text).toContain('More detail.');
    expect(text).not.toMatch(/private|https|const|```|~~~/);
    expect(text.match(/A code example is available in the chat/g)).toHaveLength(2);
  });
  it('keeps decimal values, reference labels and prose readable', () => {
    expect(speechText('1. Price: **$12.50**\n2. See [the source][r].\n[r]: https://example.com\n\n> Verified &amp; clear.'))
      .toBe('Price: $12.50. See the source. Verified and clear.');
  });
  it('keeps the full answer while splitting at sentence boundaries', () => {
    const text = Array.from({ length: 180 }, (_, i) => `Sentence ${i} has verified details.`).join(' ');
    const chunks = speechChunks(text);
    expect(chunks.length).toBeGreaterThan(10);
    expect(chunks.every(chunk => chunk.length <= 300)).toBe(true);
    expect(chunks.join(' ')).toBe(text);
    expect(chunks.at(-1)).toContain('Sentence 179');
  });
  it('opens with a short clip and prefers clause breaks over mid-phrase cuts', () => {
    const text = `${'This opening sentence is brief. '.repeat(4)}${'A longer explanation follows with more detail, '.repeat(12)}and then it ends.`;
    const chunks = speechChunks(text, 300, 160);
    expect(chunks[0]!.length).toBeLessThanOrEqual(160);
    expect(chunks[0]).toMatch(/brief\.$/);
    expect(chunks.slice(1, -1).every(chunk => chunk.endsWith(','))).toBe(true);
    expect(chunks.join(' ')).toBe(text);
  });
  it('always advances with a long unbroken token, empty text and invalid limits', () => {
    expect(speechChunks('')).toEqual([]);
    expect(speechChunks('x'.repeat(1800), Number.NaN).join('')).toBe('x'.repeat(1800));
    expect(speechChunks('x'.repeat(100), -1).every(chunk => chunk.length <= 40)).toBe(true);
  });
});
