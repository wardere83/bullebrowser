import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { DocumentFormat } from '../../shared/funding.js';
import { detectFormat, extractFromBytes, requireFormat, tooLarge } from './extract.js';
import { DEFAULT_LIMITS } from './limits.js';

const fixtures = join(dirname(fileURLToPath(import.meta.url)), '../../../test-fixtures/funding');
const fixture = (name: string) => new Uint8Array(readFileSync(join(fixtures, name)));
const bytes = (text: string) => new Uint8Array(Buffer.from(text, 'latin1'));

const PDF = fixture('org-a/budget-fy2025.pdf');
const WORD = fixture('org-a/organizational-profile.docx');
const MARKDOWN = fixture('org-a/program-descriptions.md');
const TEXT = fixture('org-a/impact-report-2024.txt');
/** The first bytes of an older .doc file, and of a .docx saved with a password. */
const LEGACY_WORD = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, ...new Uint8Array(64)]);
const PICTURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52]);

describe('working out what a file is', () => {
  it('accepts the four formats when name and contents agree', () => {
    expect(detectFormat('budget-fy2025.pdf', PDF)).toBe('pdf');
    expect(detectFormat('Organizational Profile (final).DOCX', WORD)).toBe('docx');
    expect(detectFormat('program-descriptions.md', MARKDOWN)).toBe('md');
    expect(detectFormat('notes.v2.markdown', MARKDOWN)).toBe('md');
    expect(detectFormat('impact-report-2024.txt', TEXT)).toBe('txt');
    expect(detectFormat('Résumé of results.TXT', new Uint8Array([0xff, 0xfe, ...Buffer.from('Wide text', 'utf16le')]))).toBe('txt');
    expect(detectFormat(' budget-fy2025.pdf ', PDF)).toBe('pdf');
  });

  it('finds the PDF marker anywhere in the first 1,024 bytes and nowhere after', () => {
    const within = new Uint8Array([...bytes('\n'.repeat(1019)), ...bytes('%PDF-1.7\n')]);
    const beyond = new Uint8Array([...bytes('\n'.repeat(1020)), ...bytes('%PDF-1.7\n')]);
    expect(detectFormat('scan.pdf', within)).toBe('pdf');
    expect(detectFormat('scan.pdf', beyond)).toBeNull();
  });

  it('refuses a file whose contents do not match its name', () => {
    const cases: [string, Uint8Array][] = [
      ['notes.pdf', TEXT],
      ['report.pdf', WORD],
      ['report.docx', PDF],
      ['report.docx', TEXT],
      ['report.docx', LEGACY_WORD],
      // The signature of an empty archive, which holds no document.
      ['report.docx', new Uint8Array([0x50, 0x4b, 0x05, 0x06, ...new Uint8Array(18)])],
      ['report.txt', PDF],
      // A PDF with no binary data in it is still not a text document.
      ['report.txt', fixture('invalid/truncated.pdf')],
      ['report.md', WORD],
      ['report.txt', LEGACY_WORD],
      ['report.txt', PICTURE],
      ['report.md', bytes('{\\rtf1\\ansi Rich text is markup, not plain text.}')],
    ];
    for (const [name, content] of cases) expect(detectFormat(name, content), name).toBeNull();
  });

  it('refuses every other kind of file, whatever is inside', () => {
    for (const name of ['report.doc', 'budget.xlsx', 'slides.pptx', 'page.html', 'notes.rtf', 'report', 'report.', 'report.pdf.exe', 'archive.tar.gz']) {
      expect(detectFormat(name, PDF), name).toBeNull();
      expect(detectFormat(name, TEXT), name).toBeNull();
    }
  });

  it('explains each refusal in words the person can act on', () => {
    const refusals: [string, Uint8Array, string, RegExp][] = [
      ['notes.pdf', TEXT, 'UNSUPPORTED_FILE', /named as a PDF, but its contents are not one.*export it as a PDF again/],
      ['invalid/not-a-document.docx', fixture('invalid/not-a-document.docx'), 'UNSUPPORTED_FILE', /named as a Word document, but its contents are not one/],
      ['locked.docx', LEGACY_WORD, 'UNSUPPORTED_FILE', /password-protected Word document or an older Word file.*unprotected Word document \(\.docx\) or a PDF/],
      ['report.doc', LEGACY_WORD, 'UNSUPPORTED_FILE', /Older Word files \(\.doc\) cannot be read.*save it as a Word document \(\.docx\) or a PDF/],
      ['budget.xlsx', WORD, 'UNSUPPORTED_FILE', /This kind of file cannot be read\. Upload a PDF, a Word document \(\.docx\), a Markdown file or a plain-text file\./],
      ['photo.txt', PICTURE, 'UNSUPPORTED_FILE', /named as a text file, but it does not contain plain text/],
      ['invalid/empty.txt', fixture('invalid/empty.txt'), 'EXTRACTION_FAILED', /This file is empty/],
      ['empty.pdf', new Uint8Array(), 'EXTRACTION_FAILED', /This file is empty/],
    ];
    for (const [name, content, code, message] of refusals) {
      expect(() => requireFormat(name, content), name).toThrow(expect.objectContaining({ name: 'FundingError', code, message: expect.stringMatching(message) }));
    }
    expect(requireFormat('budget-fy2025.pdf', PDF)).toBe('pdf');
    expect(requireFormat('impact-report-2024.txt', TEXT)).toBe('txt');
  });
});

describe('reading a document from its bytes', () => {
  const samples: [DocumentFormat, string, string][] = [
    ['pdf', 'org-a/strategic-plan-2025-2028.pdf', 'Harbor Lantern Collective Strategic Plan 2025-2028'],
    ['docx', 'org-b/capability-statement.docx', 'Copperline Fabrication Works LLC Capability Statement'],
    ['md', 'org-a/program-descriptions.md', 'Harbor Lantern Collective Program Descriptions'],
    ['txt', 'org-b/business-profile.txt', 'COPPERLINE FABRICATION WORKS LLC BUSINESS PROFILE'],
  ];

  it.each(samples)('hands a %s file to its reader', async (format, name, firstBlock) => {
    expect(detectFormat(name, fixture(name))).toBe(format);
    const document = await extractFromBytes(format, fixture(name));
    expect(document.format).toBe(format);
    expect(document.blocks[0]).toMatchObject({ id: 'b0001', kind: 'heading', text: firstBlock, section: '' });
    expect(document.pageCount).toBe(format === 'pdf' ? 4 : null);
    expect(document.blocks.every((block) => (block.page === null) === (format !== 'pdf'))).toBe(true);
    expect(document.blocks.every((block) => block.text === block.text.trim() && block.text !== '' && !/\s{2}|\n/.test(block.text))).toBe(true);
  });

  it.each(samples)('gives a %s file the same blocks and ids on every read', async (format, name) => {
    const first = await extractFromBytes(format, fixture(name));
    const second = await extractFromBytes(format, fixture(name));
    expect(second).toEqual(first);
    expect(first.blocks.map((block) => block.id)).toEqual(first.blocks.map((_, index) => `b${String(index + 1).padStart(4, '0')}`));
  });

  it.each<[string, DocumentFormat, string, RegExp]>([
    ['invalid/image-only.pdf', 'pdf', 'EXTRACTION_FAILED', /no selectable text.*scan or a set of images.*Upload a text-based PDF or the original document/],
    ['invalid/truncated.pdf', 'pdf', 'EXTRACTION_FAILED', /damaged or is not a valid PDF.*saving a new copy/],
    ['invalid/not-a-document.docx', 'docx', 'UNSUPPORTED_FILE', /named as a Word document, but its contents are not one/],
    ['invalid/empty.txt', 'txt', 'EXTRACTION_FAILED', /This file is empty.*Check that you picked the right file/],
  ])('fails on %s with a reason and a next step', async (name, format, code, message) => {
    await expect(extractFromBytes(format, fixture(name))).rejects.toMatchObject({
      name: 'FundingError',
      code,
      message: expect.stringMatching(message),
    });
  });

  it('never reads a text file as a PDF because of its name', async () => {
    expect(() => requireFormat('impact-report-2024.pdf', TEXT)).toThrow(expect.objectContaining({ code: 'UNSUPPORTED_FILE' }));
    // Even if a caller skips that check, the PDF reader does not accept it.
    await expect(extractFromBytes('pdf', TEXT)).rejects.toMatchObject({ code: 'EXTRACTION_FAILED', message: expect.stringMatching(/not a valid PDF/) });
  });

  it('refuses a file over the size limit and names the limit in megabytes', async () => {
    await expect(extractFromBytes('pdf', PDF, { limits: { maxFileBytes: 3 * 1024 * 1024 - 1 } })).resolves.toBeDefined();
    await expect(extractFromBytes('pdf', PDF, { limits: { maxFileBytes: 4096 } })).rejects.toMatchObject({
      code: 'FILE_TOO_LARGE',
      message: expect.stringMatching(/larger than 1 MB, the most that can be read/),
    });
    expect(DEFAULT_LIMITS.maxFileBytes).toBe(40 * 1024 * 1024);
    expect(tooLarge(DEFAULT_LIMITS)).toMatchObject({ code: 'FILE_TOO_LARGE', message: expect.stringMatching(/larger than 40 MB/) });
  });

  it('stops before reading anything when the job is already cancelled', async () => {
    const controller = new AbortController();
    controller.abort();
    for (const [format, name] of samples) {
      await expect(extractFromBytes(format, fixture(name), { signal: controller.signal })).rejects.toMatchObject({ code: 'CANCELLED' });
    }
  });

  it('refuses a format it does not know', async () => {
    await expect(extractFromBytes('rtf' as DocumentFormat, TEXT)).rejects.toMatchObject({ code: 'UNSUPPORTED_FILE' });
  });

  it('replaces whatever a reader throws with a message written for the person', async () => {
    for (const format of ['pdf', 'docx', 'md', 'txt'] as const) {
      const failure = extractFromBytes(format, null as unknown as Uint8Array);
      await expect(failure).rejects.toMatchObject({ name: 'FundingError', code: 'EXTRACTION_FAILED', message: expect.stringMatching(/could not be read/) });
      await expect(failure).rejects.not.toThrow(/null|undefined|byteLength|TypeError/);
    }
  });

  it('never puts a path, a library name or a stack trace in a message', async () => {
    const messages: string[] = [];
    const collect = (error: unknown) => messages.push((error as Error).message);
    const tries: [DocumentFormat, Uint8Array][] = [
      ['pdf', fixture('invalid/image-only.pdf')],
      ['pdf', fixture('invalid/truncated.pdf')],
      ['pdf', TEXT],
      ['pdf', new Uint8Array()],
      ['docx', fixture('invalid/not-a-document.docx')],
      ['docx', LEGACY_WORD],
      ['docx', WORD.slice(0, 900)],
      ['docx', new Uint8Array()],
      ['txt', PICTURE],
      ['txt', new Uint8Array()],
      ['md', bytes(' \n ')],
      ['md', PDF],
    ];
    for (const [format, content] of tries) await extractFromBytes(format, content).then(() => messages.push('unexpectedly read'), collect);
    for (const [name, content] of [['a.doc', TEXT], ['a.pdf', TEXT], ['a.docx', TEXT], ['a.txt', PICTURE], ['a.xyz', TEXT]] as const) {
      try {
        requireFormat(name, content);
      } catch (error) {
        collect(error);
      }
    }
    messages.push(tooLarge(DEFAULT_LIMITS).message);

    expect(messages).toHaveLength(tries.length + 6);
    for (const message of messages) {
      expect(message).not.toMatch(/unexpectedly read/);
      expect(message).not.toMatch(/[\\/]|node_modules|\.js\b|\.mjs\b|\bat \w+ \(/);
      expect(message).not.toMatch(/pdf\.?js|pdfjs|yauzl|saxes|mdast|micromark|zlib|\bzip\b|\bxml\b|exception|errno/i);
      // A full sentence that ends by telling the person what to do.
      expect(message).toMatch(/^[A-Z].*\.$/);
    }
  });
});
