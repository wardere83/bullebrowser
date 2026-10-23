import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import net from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadPdfjs } from './pdfjs-loader.js';
import { extractPdf, pdfOpenOptions } from './pdf.js';
import { SECTION_SEPARATOR, type ExtractedDocument } from './types.js';

const fixtures = join(dirname(fileURLToPath(import.meta.url)), '../../../test-fixtures/funding');
const fixture = (name: string) => new Uint8Array(readFileSync(join(fixtures, name)));
const under = (...headings: string[]) => headings.join(SECTION_SEPARATOR);
const texts = (document: ExtractedDocument) => document.blocks.map((block) => block.text);
const block = (document: ExtractedDocument, text: string) => document.blocks.find((candidate) => candidate.text === text);

// A minimal PDF writer, so that tests can state exactly what a file contains:
// where each line sits, how large it is, and what the file says about itself.

interface Run {
  text: string;
  x?: number;
  y: number;
  size?: number;
  /** Structure tag for this run when the document is tagged, e.g. "H1". */
  tag?: string;
}

interface Bookmark {
  title: string;
  page?: number;
  /** A named destination instead of a direct one. */
  named?: string;
  children?: Bookmark[];
}

type AddObject = (body: string, stream?: Buffer) => number;

interface PdfExtras {
  outline?: Bookmark[];
  namedDestinations?: Record<string, number>;
  tagged?: boolean;
  /** Encrypts the file. An empty user password opens freely but keeps the permissions. */
  protect?: { user: string; permissions: number };
  catalog?: (add: AddObject) => string;
  page?: (add: AddObject, fontId: number) => { entries?: string; resources?: string; content?: string };
  /** Sets the text running up the page, as on a landscape page stored sideways. */
  sideways?: boolean;
  /** Lists one more page than exists. */
  danglingPage?: boolean;
}

const PASSWORD_PADDING = Buffer.from(
  '28bf4e5e4e758a4164004e56fffa01082e2e00b6d0683e802f0ca9fe6453697a',
  'hex',
);

function rc4(key: Uint8Array, data: Uint8Array): Buffer {
  const state = Uint8Array.from({ length: 256 }, (_, index) => index);
  for (let i = 0, j = 0; i < 256; i += 1) {
    j = (j + state[i]! + key[i % key.length]!) & 255;
    [state[i], state[j]] = [state[j]!, state[i]!];
  }
  const out = Buffer.alloc(data.length);
  for (let n = 0, i = 0, j = 0; n < data.length; n += 1) {
    i = (i + 1) & 255;
    j = (j + state[i]!) & 255;
    [state[i], state[j]] = [state[j]!, state[i]!];
    out[n] = data[n]! ^ state[(state[i]! + state[j]!) & 255]!;
  }
  return out;
}

const md5 = (...parts: Uint8Array[]) => createHash('md5').update(Buffer.concat(parts)).digest();
const padded = (password: string) => Buffer.concat([Buffer.from(password, 'latin1'), PASSWORD_PADDING]).subarray(0, 32);

function buildPdf(pages: Run[][], extras: PdfExtras = {}): Uint8Array {
  const objects: ({ body: string; stream?: Buffer } | null)[] = [];
  const reserve = () => objects.push(null);
  const add: AddObject = (body, stream) => objects.push({ body, stream });
  const set = (id: number, body: string, stream?: Buffer) => {
    objects[id - 1] = { body, stream };
  };
  const literal = (text: string) => text.replace(/\(/g, '\\(').replace(/\)/g, '\\)');

  const catalogId = reserve();
  const pagesId = reserve();
  const fontId = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  const structRootId = extras.tagged ? reserve() : 0;
  const documentElementId = extras.tagged ? reserve() : 0;
  const pageIds: number[] = [];
  const elementsByPage: number[][] = [];

  pages.forEach((runs, pageIndex) => {
    const pageId = reserve();
    pageIds.push(pageId);
    const elements: number[] = [];
    const lines = runs.map((run, index) => {
      const size = run.size ?? 11;
      const x = run.x ?? 72;
      const place = extras.sideways ? `0 1 -1 0 ${800 - run.y} ${x} Tm` : `1 0 0 1 ${x} ${run.y} Tm`;
      const show = `BT /F1 ${size} Tf ${place} (${literal(run.text)}) Tj ET`;
      if (!extras.tagged) return show;
      // Marked as not part of the document, and so left out of its structure.
      if (run.tag === 'Artifact') return `/Artifact << /Type /Pagination >> BDC ${show} EMC`;
      const role = run.tag ?? 'P';
      const elementId = add(
        `<< /Type /StructElem /S /${role} /P ${documentElementId} 0 R /Pg ${pageId} 0 R /K ${index} >>`,
      );
      elements.push(elementId);
      return `/${role} << /MCID ${index} >> BDC ${show} EMC`;
    });
    elementsByPage.push(elements);
    const extra = extras.page?.(add, fontId) ?? {};
    const content = Buffer.from([...lines, extra.content ?? ''].join('\n'), 'latin1');
    const contentId = add(`<< /Length ${content.length} >>`, content);
    set(
      pageId,
      `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 612 792] ` +
        `/Resources << /Font << /F1 ${fontId} 0 R >> ${extra.resources ?? ''} >> /Contents ${contentId} 0 R` +
        `${extras.tagged ? ` /StructParents ${pageIndex}` : ''} ${extra.entries ?? ''} >>`,
    );
  });

  const kids = pageIds.map((id) => `${id} 0 R`);
  if (extras.danglingPage) kids.push(`${objects.length + 500} 0 R`);
  set(pagesId, `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${kids.length} >>`);

  let catalog = `<< /Type /Catalog /Pages ${pagesId} 0 R`;
  if (extras.tagged) {
    const everyElement = elementsByPage.flat().map((id) => `${id} 0 R`).join(' ');
    const parents = elementsByPage.map((ids, index) => `${index} [${ids.map((id) => `${id} 0 R`).join(' ')}]`).join(' ');
    const parentTreeId = add(`<< /Nums [${parents}] >>`);
    set(documentElementId, `<< /Type /StructElem /S /Document /P ${structRootId} 0 R /K [${everyElement}] >>`);
    set(structRootId, `<< /Type /StructTreeRoot /K ${documentElementId} 0 R /ParentTree ${parentTreeId} 0 R >>`);
    catalog += ` /MarkInfo << /Marked true >> /StructTreeRoot ${structRootId} 0 R`;
  }
  if (extras.outline) {
    const outlinesId = reserve();
    const write = (items: Bookmark[], parentId: number): number[] => {
      const ids = items.map(() => reserve());
      items.forEach((item, index) => {
        let body = `<< /Title (${literal(item.title)}) /Parent ${parentId} 0 R`;
        if (index > 0) body += ` /Prev ${ids[index - 1]} 0 R`;
        if (index < items.length - 1) body += ` /Next ${ids[index + 1]} 0 R`;
        if (item.named) body += ` /Dest /${item.named}`;
        else if (item.page) body += ` /Dest [${pageIds[item.page - 1]} 0 R /XYZ 0 792 0]`;
        if (item.children?.length) {
          const children = write(item.children, ids[index]!);
          body += ` /First ${children[0]} 0 R /Last ${children[children.length - 1]} 0 R /Count ${children.length}`;
        }
        set(ids[index]!, `${body} >>`);
      });
      return ids;
    };
    const top = write(extras.outline, outlinesId);
    set(outlinesId, `<< /Type /Outlines /First ${top[0]} 0 R /Last ${top[top.length - 1]} 0 R /Count ${top.length} >>`);
    catalog += ` /Outlines ${outlinesId} 0 R`;
  }
  if (extras.namedDestinations) {
    const entries = Object.entries(extras.namedDestinations).map(
      ([name, page]) => `/${name} [${pageIds[page - 1]} 0 R /XYZ 0 792 0]`,
    );
    catalog += ` /Dests << ${entries.join(' ')} >>`;
  }
  if (extras.catalog) catalog += ` ${extras.catalog(add)}`;
  set(catalogId, `${catalog} >>`);

  let trailer = '';
  let fileKey: Buffer | null = null;
  if (extras.protect) {
    // The standard password scheme in its simplest form (40-bit RC4).
    const fileId = Buffer.from('00112233445566778899aabbccddeeff', 'hex');
    const permissions = Buffer.alloc(4);
    permissions.writeInt32LE(extras.protect.permissions);
    const ownerEntry = rc4(md5(padded('owner')).subarray(0, 5), padded(extras.protect.user));
    fileKey = md5(padded(extras.protect.user), ownerEntry, permissions, fileId).subarray(0, 5);
    const userEntry = rc4(fileKey, PASSWORD_PADDING);
    const encryptId = add(
      `<< /Filter /Standard /V 1 /R 2 /O <${ownerEntry.toString('hex')}> /U <${userEntry.toString('hex')}> /P ${extras.protect.permissions} >>`,
    );
    trailer = ` /Encrypt ${encryptId} 0 R /ID [<${fileId.toString('hex')}> <${fileId.toString('hex')}>]`;
  }

  const chunks: Buffer[] = [Buffer.from('%PDF-1.7\n%\xE2\xE3\xCF\xD3\n', 'latin1')];
  const offsets: number[] = [];
  let length = chunks[0]!.length;
  objects.forEach((object, index) => {
    if (!object) throw new Error(`object ${index + 1} was reserved but never written`);
    offsets.push(length);
    const parts: Buffer[] = [Buffer.from(`${index + 1} 0 obj\n${object.body}\n`, 'latin1')];
    if (object.stream) {
      const number = Buffer.from([(index + 1) & 255, ((index + 1) >> 8) & 255, ((index + 1) >> 16) & 255, 0, 0]);
      const data = fileKey ? rc4(md5(fileKey, number).subarray(0, 10), object.stream) : object.stream;
      parts.push(Buffer.from('stream\n', 'latin1'), data, Buffer.from('\nendstream\n', 'latin1'));
    }
    parts.push(Buffer.from('endobj\n', 'latin1'));
    for (const part of parts) {
      chunks.push(part);
      length += part.length;
    }
  });
  const table = offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  chunks.push(
    Buffer.from(
      `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${table}` +
        `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R${trailer} >>\nstartxref\n${length}\n%%EOF\n`,
      'latin1',
    ),
  );
  return new Uint8Array(Buffer.concat(chunks));
}

/** Lines of body text, one below the other, the way a paragraph is set. */
function paragraph(lines: string[], top: number, options: { spacing?: number; size?: number; x?: number } = {}): Run[] {
  const spacing = options.spacing ?? 14;
  return lines.map((text, index) => ({ text, y: top - index * spacing, size: options.size ?? 11, x: options.x }));
}

const FULL = 'This line of ordinary body text is long enough to reach the right-hand margin';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the sample documents', () => {
  it('reads the strategic plan as paragraphs that know their page and section', async () => {
    const document = await extractPdf(fixture('org-a/strategic-plan-2025-2028.pdf'));
    expect(document.format).toBe('pdf');
    expect(document.pageCount).toBe(4);
    expect(document.warnings).toEqual([]);

    const title = 'Harbor Lantern Collective Strategic Plan 2025-2028';
    expect(block(document, title)).toMatchObject({ id: 'b0001', kind: 'heading', headingLevel: 1, page: 1, section: '' });
    expect(block(document, 'Our Mission')).toMatchObject({ kind: 'heading', headingLevel: 2, page: 1, section: title });
    // Two lines on the page, one block here.
    expect(
      block(
        document,
        "Harbor Lantern Collective strengthens economic mobility for working families in Newark's East Ward through adult education, workforce training and small-business coaching.",
      ),
    ).toMatchObject({ kind: 'paragraph', page: 1, section: under(title, 'Our Mission'), headingLevel: null });

    expect(
      block(document, 'Priority 2. Open a shared-use incubator kitchen for food entrepreneurs by 2027.'),
    ).toMatchObject({ kind: 'paragraph', page: 3, section: 'Strategic Priorities 2025-2028' });
    // A new top-level heading replaces the previous one rather than nesting under it.
    expect(block(document, 'Funding Goals')).toMatchObject({ page: 4, section: 'Resourcing the Plan' });
    expect(document.blocks.map((entry) => entry.id)).toEqual(
      document.blocks.map((_, index) => `b${String(index + 1).padStart(4, '0')}`),
    );
    const words = texts(document).join(' ').split(' ').filter((word) => /[\p{L}\p{N}]/u.test(word));
    expect(document.wordCount).toBe(words.length);
    expect(document.wordCount).toBe(326);
  });

  it('keeps every budget row as its own block so that an amount can be cited', async () => {
    const document = await extractPdf(fixture('org-a/budget-fy2025.pdf'));
    expect(document.pageCount).toBe(1);
    const total = document.blocks.find((entry) => entry.text.includes('Total revenue'));
    expect(total).toMatchObject({ kind: 'table_row', page: 1 });
    expect(total!.text).toContain('$1,912,400');
    expect(total!.text).not.toContain('Corporate sponsorships');
    expect(total!.section).toBe(under('Harbor Lantern Collective Operating Budget, Fiscal Year 2025', 'Revenue'));
    expect(block(document, 'Personnel $1,263,000')).toMatchObject({ kind: 'table_row' });
    // A title wrapped onto two lines is one heading.
    expect(document.blocks[0]).toMatchObject({
      kind: 'heading',
      text: 'Harbor Lantern Collective Operating Budget, Fiscal Year 2025',
    });
  });

  it('reads the funding notice with its dates on page 4 and its rules on AI tools on page 6', async () => {
    const document = await extractPdf(fixture('rfp/neighborhood-workforce-pathways-nofa.pdf'));
    expect(document.pageCount).toBe(6);
    expect(document.warnings).toEqual([]);

    const dates = document.blocks.filter((entry) => entry.section === under('4. Award Information', '4.4 Key Dates'));
    expect(dates.map((entry) => entry.text)).toEqual([
      'Milestone Date',
      'Letters of intent due March 5, 2027',
      'Written questions due March 26, 2027',
      'Full applications due April 16, 2027 at 5:00 p.m. Eastern Time',
      'Award notifications expected June 4, 2027',
    ]);
    expect(dates.every((entry) => entry.page === 4 && entry.kind === 'table_row')).toBe(true);

    // The heading contains an "fi" ligature, which is read as two letters.
    const rules = document.blocks.filter(
      (entry) => entry.section === under('6. Submission and Reporting', '6.3 Use of Artificial Intelligence Tools'),
    );
    expect(rules.map((entry) => entry.page)).toEqual([6, 6]);
    expect(rules[0]!.text).toBe(
      "Applicants may use generative artificial intelligence tools to edit or format their own writing, but the project narrative must be the applicant's original work.",
    );
    expect(rules[1]!.text).toMatch(/^Any use of such tools must be disclosed in Attachment F\./);
  });

  it('gives the same blocks and ids every time', async () => {
    const first = await extractPdf(fixture('rfp/neighborhood-workforce-pathways-nofa.pdf'));
    const second = await extractPdf(fixture('rfp/neighborhood-workforce-pathways-nofa.pdf'));
    expect(second).toEqual(first);
  });

  it('leaves the bytes it was given untouched', async () => {
    const bytes = fixture('org-a/budget-fy2025.pdf');
    const copy = bytes.slice();
    await extractPdf(bytes);
    expect(bytes).toEqual(copy);
  });
});

describe('files that cannot be read', () => {
  it('says that a PDF of images has no text and what to upload instead', async () => {
    await expect(extractPdf(fixture('invalid/image-only.pdf'))).rejects.toMatchObject({
      code: 'EXTRACTION_FAILED',
      message: expect.stringMatching(/no selectable text.*scan.*Upload a text-based PDF or the original document/s),
    });
  });

  it('reports a truncated or garbled file as damaged without quoting the parser', async () => {
    const garbled = new Uint8Array(Buffer.from('%PDF-1.7\n' + 'not really a document '.repeat(40)));
    for (const bytes of [fixture('invalid/truncated.pdf'), garbled]) {
      const failure = extractPdf(bytes);
      await expect(failure).rejects.toMatchObject({ code: 'EXTRACTION_FAILED', message: expect.stringMatching(/damaged/) });
      await expect(failure).rejects.not.toThrow(/Invalid PDF structure|pdf\.?js|node_modules|\//i);
    }
  });

  it('treats pages that hold only a page number as having no text', async () => {
    await expect(extractPdf(buildPdf([[{ text: '1', y: 40 }], [{ text: '2', y: 40 }]]))).rejects.toMatchObject({
      code: 'EXTRACTION_FAILED',
      message: expect.stringMatching(/no selectable text/),
    });
    // A dozen characters on a page is enough to be a document.
    const short = await extractPdf(buildPdf([[{ text: 'Thank you all!', y: 400 }]]));
    expect(texts(short)).toEqual(['Thank you all!']);
  });

  it('reports an empty file as empty', async () => {
    await expect(extractPdf(new Uint8Array())).rejects.toMatchObject({
      code: 'EXTRACTION_FAILED',
      message: expect.stringMatching(/empty/),
    });
  });

  it('asks for an unprotected copy of a password-protected PDF', async () => {
    const locked = buildPdf([paragraph(['Confidential budget notes.'], 700)], { protect: { user: 'secret', permissions: -1 } });
    await expect(extractPdf(locked)).rejects.toMatchObject({
      code: 'EXTRACTION_FAILED',
      message: expect.stringMatching(/password-protected.*Remove the password/),
    });
  });

  it('refuses a PDF with more pages than the limit, naming both numbers', async () => {
    await expect(
      extractPdf(fixture('org-a/strategic-plan-2025-2028.pdf'), { limits: { maxPages: 3 } }),
    ).rejects.toMatchObject({ code: 'EXTRACTION_FAILED', message: expect.stringMatching(/has 4 pages.*is 3\. Split it/) });
  });

  it('stops when the job is cancelled', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      extractPdf(fixture('org-a/budget-fy2025.pdf'), { signal: controller.signal }),
    ).rejects.toMatchObject({ code: 'CANCELLED' });
  });
});

describe('findings reported as warnings', () => {
  it('names the pages that have no readable text', async () => {
    const page = paragraph(['A page with a sentence of real text on it.'], 700);
    const document = await extractPdf(buildPdf([page, [], page, [], [], [], page]));
    expect(document.pageCount).toBe(7);
    expect(document.warnings).toEqual(['Pages 2 and 4–6 have no readable text and were skipped.']);
    expect(document.blocks.map((entry) => entry.page)).toEqual([1, 3, 7]);

    const two = await extractPdf(buildPdf([page, page, [], page, page, page, []]));
    expect(two.warnings).toEqual(['Pages 3 and 7 have no readable text and were skipped.']);
    const one = await extractPdf(buildPdf([page, []]));
    expect(one.warnings).toEqual(['Page 2 has no readable text and was skipped.']);
  });

  it('cuts a long list of pages short', async () => {
    const page = paragraph(['A page with a sentence of real text on it.'], 700);
    const document = await extractPdf(buildPdf(Array.from({ length: 24 }, (_, index) => (index % 2 === 0 ? page : []))));
    expect(document.warnings).toEqual([
      'Pages 2, 4, 6, 8, 10, 12, 14, 16, 18, 20 and 2 more have no readable text and were skipped.',
    ]);
  });

  it('reads the pages it can and names one that is broken', async () => {
    const page = paragraph(['A page with a sentence of real text on it.'], 700);
    const document = await extractPdf(buildPdf([page, page], { danglingPage: true }));
    expect(document.pageCount).toBe(3);
    expect(document.blocks).toHaveLength(2);
    expect(document.warnings).toEqual(['Page 3 could not be read and was skipped.']);
  });

  it('stops at the character budget and says how far it got', async () => {
    const document = await extractPdf(fixture('rfp/neighborhood-workforce-pathways-nofa.pdf'), {
      limits: { maxCharacters: 900 },
    });
    expect(document.pageCount).toBe(6);
    expect(document.warnings).toEqual(['This PDF is very long, so only its first 2 pages were read.']);
    expect(Math.max(...document.blocks.map((entry) => entry.page ?? 0))).toBe(2);
  });

  it('says when typed-in form answers were not read', async () => {
    const form = buildPdf([paragraph(['Applicant name:'], 700)], {
      catalog: (add) => `/AcroForm << /Fields [${add('<< /FT /Tx /T (name) /V (Harbor Lantern Collective) >>')} 0 R] >>`,
    });
    const document = await extractPdf(form);
    expect(texts(document)).toEqual(['Applicant name:']);
    expect(document.warnings).toEqual([expect.stringMatching(/fillable form fields.*not read/)]);
  });

  it('reads a PDF whose author restricted copying, and says so', async () => {
    const restricted = buildPdf([paragraph(['Eligible applicants are nonprofit organizations.'], 700)], {
      protect: { user: '', permissions: -1 & ~0x10 },
    });
    const document = await extractPdf(restricted);
    expect(texts(document)).toEqual(['Eligible applicants are nonprofit organizations.']);
    expect(document.warnings).toEqual(['The author of this PDF restricted copying its text.']);
  });
});

describe('paragraphs', () => {
  it('measures line spacing, so double-spaced text is not broken into single lines', async () => {
    const first = paragraph([FULL, FULL, 'and then it ends here.'], 700, { spacing: 24, size: 12 });
    const second = paragraph([FULL, 'before this one ends too.'], 700 - 3 * 24 - 24, { spacing: 24, size: 12 });
    const document = await extractPdf(buildPdf([[...first, ...second]]));
    expect(texts(document)).toEqual([`${FULL} ${FULL} and then it ends here.`, `${FULL} before this one ends too.`]);
  });

  it('separates tightly spaced paragraphs that a fixed rule would run together', async () => {
    // 12-point text on 13.8-point lines with 6 points between paragraphs.
    const first = paragraph([FULL, FULL, 'and then it ends here.'], 700, { spacing: 13.8, size: 12 });
    const second = paragraph([FULL, 'before this one ends too.'], 700 - 2 * 13.8 - 19.8, { spacing: 13.8, size: 12 });
    const document = await extractPdf(buildPdf([[...first, ...second]]));
    expect(texts(document)).toEqual([`${FULL} ${FULL} and then it ends here.`, `${FULL} before this one ends too.`]);
  });

  it('starts a new block when the text jumps back up the page into another column', async () => {
    const left = paragraph(['The left column starts here', 'and continues on this line.'], 700, { x: 72 });
    const right = paragraph(['The right column starts here', 'and ends on this line.'], 700, { x: 330 });
    const document = await extractPdf(buildPdf([[...left, ...right]]));
    expect(texts(document)).toEqual([
      'The left column starts here and continues on this line.',
      'The right column starts here and ends on this line.',
    ]);
  });

  it('never carries a paragraph across a page, since each block names one page', async () => {
    const document = await extractPdf(buildPdf([paragraph([FULL], 80), paragraph(['and carries on overleaf.'], 720)]));
    expect(document.blocks.map((entry) => [entry.page, entry.text])).toEqual([
      [1, FULL],
      [2, 'and carries on overleaf.'],
    ]);
  });

  it('reads a page whose text runs sideways', async () => {
    const lines = paragraph(['Text on a page that was stored sideways', 'still forms one paragraph.'], 700);
    const document = await extractPdf(buildPdf([[...lines, { text: 'A separate note further down.', y: 640 }]], { sideways: true }));
    expect(texts(document)).toEqual([
      'Text on a page that was stored sideways still forms one paragraph.',
      'A separate note further down.',
    ]);
  });

  it('does not run small print into the paragraph above it', async () => {
    const document = await extractPdf(
      buildPdf([
        [
          ...paragraph(['Awards will range from $75,000', 'to $250,000 per applicant.'], 700),
          { text: 'Subject to appropriations.', y: 672, size: 8 },
        ],
      ]),
    );
    expect(texts(document)).toEqual(['Awards will range from $75,000 to $250,000 per applicant.', 'Subject to appropriations.']);
  });

  it('starts a new line where the file gives no line end, as with a footer stamped onto the page', async () => {
    const stamped = buildPdf(
      [
        [
          ...paragraph(['A paragraph of ordinary body text', 'that ends on this line.'], 700),
          { text: 'Eligibility', y: 120, size: 16 },
        ],
      ],
      {
        // The stamp is a separate drawing placed on the page, the way such marks are added afterwards.
        page: (add, fontId) => {
          const drawing = Buffer.from('BT /F1 9 Tf 1 0 0 1 72 40 Tm (Received by the clerk on March 5, 2027.) Tj ET', 'latin1');
          const stamp = add(
            `<< /Type /XObject /Subtype /Form /BBox [0 0 612 792] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Length ${drawing.length} >>`,
            drawing,
          );
          return { resources: `/XObject << /Stamp ${stamp} 0 R >>`, content: '/Stamp Do' };
        },
      },
    );
    const document = await extractPdf(stamped);
    expect(document.blocks.map((entry) => [entry.kind, entry.text])).toEqual([
      ['paragraph', 'A paragraph of ordinary body text that ends on this line.'],
      ['heading', 'Eligibility'],
      ['paragraph', 'Received by the clerk on March 5, 2027.'],
    ]);
  });

  it('keeps figures apart when a line is drawn out of order', async () => {
    const document = await extractPdf(
      buildPdf([
        [
          { text: '% Change', x: 420, y: 700 },
          { text: '2023', x: 100, y: 700 },
          { text: '2022', x: 220, y: 700 },
          { text: '615,404', x: 100, y: 680 },
          { text: '456,679', x: 220, y: 680 },
          { text: '35', x: 420, y: 680 },
        ],
      ]),
    );
    expect(document.blocks.map((entry) => [entry.kind, entry.text])).toEqual([
      ['table_row', '% Change 2023 2022'],
      ['table_row', '615,404 456,679 35'],
    ]);
  });

  it('starts a new block at every bullet, however tightly a list is set', async () => {
    const document = await extractPdf(
      buildPdf([
        [
          { text: 'Grant funds may pay for:', y: 700, size: 10 },
          { text: '\\225 Instruction and participant supports,', y: 688, size: 10 },
          { text: 'including child care.', y: 676, size: 10 },
          { text: '\\225 Staff salaries.', y: 664, size: 10 },
          { text: '\\225 Evaluation.', y: 652, size: 10 },
        ],
      ]),
    );
    expect(document.blocks.map((entry) => [entry.kind, entry.text])).toEqual([
      ['paragraph', 'Grant funds may pay for:'],
      ['list_item', 'Instruction and participant supports, including child care.'],
      ['list_item', 'Staff salaries.'],
      ['list_item', 'Evaluation.'],
    ]);
  });

  it('keeps table rows apart even when they are set as tightly as running text', async () => {
    const row = (label: string, amount: string, y: number): Run[] => [
      { text: label, x: 72, y, size: 10 },
      { text: amount, x: 400, y, size: 10 },
    ];
    const document = await extractPdf(
      buildPdf([[...row('Personnel', '$1,263,000', 700), ...row('Occupancy', '$168,000', 688), ...row('Total', '$1,431,000', 676)]]),
    );
    expect(document.blocks.map((entry) => [entry.kind, entry.text])).toEqual([
      ['table_row', 'Personnel $1,263,000'],
      ['table_row', 'Occupancy $168,000'],
      ['table_row', 'Total $1,431,000'],
    ]);
  });

  it('keeps a row together when the text of its last cell wraps onto further lines', async () => {
    const document = await extractPdf(
      buildPdf([
        [
          { text: 'Full applications due', x: 72, y: 700 },
          { text: 'April 16, 2027 at 5:00 p.m.', x: 300, y: 700 },
          { text: 'Eastern Time, through the', x: 300, y: 686 },
          { text: 'vendor portal only', x: 300, y: 672 },
          { text: 'Paper applications are not accepted.', x: 72, y: 658 },
          { text: 'Award notifications', x: 72, y: 630 },
          { text: 'June 4, 2027', x: 300, y: 630 },
          { text: 'Notices are sent by email.', x: 72, y: 616 },
        ],
      ]),
    );
    // Lines just as close below a row, but set at the margin rather than under its last cell, are not part of it.
    expect(document.blocks.map((entry) => [entry.kind, entry.text])).toEqual([
      ['table_row', 'Full applications due April 16, 2027 at 5:00 p.m. Eastern Time, through the vendor portal only'],
      ['paragraph', 'Paper applications are not accepted.'],
      ['table_row', 'Award notifications June 4, 2027'],
      ['paragraph', 'Notices are sent by email.'],
    ]);
  });

  it('does not mistake a numbered or bulleted line for a table row', async () => {
    const document = await extractPdf(
      buildPdf([
        [
          { text: '(a)', x: 72, y: 700 },
          { text: 'The applicant must hold an active registration', x: 120, y: 700 },
          { text: 'at the time of application.', x: 120, y: 686 },
          { text: '\\225', x: 72, y: 650 },
          { text: 'Bilingual training models.', x: 120, y: 650 },
        ],
      ]),
    );
    expect(document.blocks.map((entry) => [entry.kind, entry.text])).toEqual([
      ['paragraph', '(a) The applicant must hold an active registration at the time of application.'],
      ['list_item', 'Bilingual training models.'],
    ]);
  });

  it('writes typographic forms as plain characters, without letting a superscript join a figure', async () => {
    // In this encoding 271 is a superscript one, 262 a superscript two and 231 a trademark sign.
    const document = await extractPdf(buildPdf([[{ text: 'We request $400,000\\271 for 500 m\\262 of Lantern\\231 space.', y: 700 }]]));
    expect(texts(document)).toEqual(['We request $400,000 1 for 500 m2 of LanternTM space.']);
  });

  it('sets a raised footnote mark apart from the figure it follows', async () => {
    const document = await extractPdf(
      buildPdf([
        [
          { text: 'The request is $400,000', x: 72, y: 700, size: 11 },
          { text: '1', x: 187, y: 704, size: 6 },
          { text: ' over two years.', x: 190, y: 700, size: 11 },
        ],
      ]),
    );
    expect(texts(document)).toEqual(['The request is $400,000 1 over two years.']);
  });
});

describe('headings', () => {
  const body = (chapter: number): Run[] => [
    { text: `Chapter ${chapter} Overview`, y: 720, tag: 'H1' },
    { text: 'The first line of a paragraph that carries on', y: 690 },
    { text: 'to a second line right below it.', y: 676 },
    { text: `Details for part ${chapter}`, y: 640, tag: 'H2' },
    { text: 'Another paragraph sits under the smaller heading.', y: 612 },
  ];
  const outlined = (document: ExtractedDocument) =>
    document.blocks.map((entry) => `${entry.kind}${entry.headingLevel ?? ''} p${entry.page} [${entry.section}] ${entry.text}`);

  it('takes them from the bookmarks when the titles are on the pages they point to', async () => {
    // Every line is the same size, so nothing but the bookmarks marks a heading.
    const document = await extractPdf(
      buildPdf([body(1), body(2)], {
        outline: [
          { title: 'Chapter 1: Overview', page: 1, children: [{ title: 'Details for part 1', page: 1 }] },
          { title: 'Chapter 2 Overview', named: 'second', children: [{ title: 'Details for part 2', page: 2 }] },
          { title: 'Appendix that is not in the text', page: 2 },
        ],
        namedDestinations: { second: 2 },
      }),
    );
    expect(outlined(document)).toEqual([
      'heading1 p1 [] Chapter 1 Overview',
      'paragraph p1 [Chapter 1 Overview] The first line of a paragraph that carries on to a second line right below it.',
      'heading2 p1 [Chapter 1 Overview] Details for part 1',
      `paragraph p1 [${under('Chapter 1 Overview', 'Details for part 1')}] Another paragraph sits under the smaller heading.`,
      'heading1 p2 [] Chapter 2 Overview',
      'paragraph p2 [Chapter 2 Overview] The first line of a paragraph that carries on to a second line right below it.',
      'heading2 p2 [Chapter 2 Overview] Details for part 2',
      `paragraph p2 [${under('Chapter 2 Overview', 'Details for part 2')}] Another paragraph sits under the smaller heading.`,
    ]);
    // A bookmark never becomes text of its own.
    expect(texts(document).join(' ')).not.toContain('Appendix');
  });

  it('matches a bookmark to a title that carries a number, wraps onto two lines or is echoed in a header', async () => {
    const page: Run[] = [
      // A running header that repeats the chapter title in small type.
      { text: 'Closing remarks', y: 770, size: 7 },
      { text: '3. Closing remarks', y: 720 },
      { text: 'The first paragraph of the last chapter.', y: 690 },
      { text: 'What the Board decided about the reserve', y: 650 },
      { text: 'fund and the line of credit', y: 636 },
      { text: 'The second paragraph of the last chapter.', y: 606 },
    ];
    const document = await extractPdf(
      buildPdf([page], {
        outline: [
          { title: 'Closing remarks', page: 1 },
          { title: 'What the Board decided about the reserve fund and the line of credit', page: 1 },
        ],
      }),
    );
    expect(outlined(document)).toEqual([
      'paragraph p1 [] Closing remarks',
      'heading1 p1 [] 3. Closing remarks',
      'paragraph p1 [3. Closing remarks] The first paragraph of the last chapter.',
      'heading1 p1 [] What the Board decided about the reserve fund and the line of credit',
      'paragraph p1 [What the Board decided about the reserve fund and the line of credit] The second paragraph of the last chapter.',
    ]);
  });

  it('ignores bookmarks that do not describe the text', async () => {
    const document = await extractPdf(
      buildPdf([body(1)], {
        outline: [
          { title: 'Cover', page: 1 },
          { title: 'Contents', page: 1 },
          { title: 'Chapter 1 Overview', page: 1 },
        ],
      }),
    );
    expect(document.blocks.every((entry) => entry.kind === 'paragraph' && entry.section === '')).toBe(true);
  });

  it("takes them from the PDF's structure tags when it has no bookmarks", async () => {
    const document = await extractPdf(buildPdf([body(1), body(2)], { tagged: true }));
    expect(outlined(document)).toEqual([
      'heading1 p1 [] Chapter 1 Overview',
      'paragraph p1 [Chapter 1 Overview] The first line of a paragraph that carries on to a second line right below it.',
      'heading2 p1 [Chapter 1 Overview] Details for part 1',
      `paragraph p1 [${under('Chapter 1 Overview', 'Details for part 1')}] Another paragraph sits under the smaller heading.`,
      'heading1 p2 [] Chapter 2 Overview',
      'paragraph p2 [Chapter 2 Overview] The first line of a paragraph that carries on to a second line right below it.',
      'heading2 p2 [Chapter 2 Overview] Details for part 2',
      `paragraph p2 [${under('Chapter 2 Overview', 'Details for part 2')}] Another paragraph sits under the smaller heading.`,
    ]);
  });

  it('falls back to text size, with larger type as the higher level', async () => {
    const sized = (chapter: number): Run[] =>
      body(chapter).map((run) => ({ ...run, tag: undefined, size: run.tag === 'H1' ? 18 : run.tag === 'H2' ? 13 : 11 }));
    const document = await extractPdf(buildPdf([sized(1), sized(2)]));
    expect(document.blocks.filter((entry) => entry.kind === 'heading').map((entry) => [entry.headingLevel, entry.text])).toEqual([
      [1, 'Chapter 1 Overview'],
      [2, 'Details for part 1'],
      [1, 'Chapter 2 Overview'],
      [2, 'Details for part 2'],
    ]);
  });

  it('does not take a table of contents, or a document set mostly in large type, for headings', async () => {
    const contents = await extractPdf(
      buildPdf([
        [
          { text: 'Introduction ........................ 3', y: 720, size: 14 },
          ...paragraph([FULL, FULL, 'and then it ends here.'], 690),
        ],
      ]),
    );
    expect(contents.blocks.map((entry) => entry.kind)).toEqual(['paragraph', 'paragraph']);

    const slides = await extractPdf(
      buildPdf([
        [
          { text: 'Welcome to the annual meeting', y: 720, size: 24 },
          { text: 'Agenda for the evening', y: 660, size: 20 },
          { text: 'Thank you for coming', y: 600, size: 22 },
          { text: 'a small credit line', y: 560, size: 8 },
          { text: 'another small credit line that is the longest text here by some way', y: 540, size: 8 },
        ],
      ]),
    );
    expect(slides.blocks.every((entry) => entry.kind === 'paragraph')).toBe(true);
  });
});

describe('running headers and footers', () => {
  const content = (page: number): Run[] =>
    Array.from({ length: 6 }, (_, line) => ({
      text: `Sentence ${line + 1} of the body text on sheet ${'ABCD'[page - 1]} stands alone.`,
      y: 700 - line * 40,
    }));
  const withFurniture = (page: number, lines: Run[]): Run[] => [
    { text: 'Tri-County Office of Neighborhood Opportunity', y: 760, size: 9 },
    ...lines,
    { text: `Page ${page} of 4`, y: 40, size: 9 },
  ];

  it('leaves out lines that repeat at the edges of most pages, and says which', async () => {
    const document = await extractPdf(buildPdf([1, 2, 3, 4].map((page) => withFurniture(page, content(page)))));
    expect(document.blocks).toHaveLength(24);
    expect(texts(document).join(' ')).not.toMatch(/Tri-County|Page \d of 4/);
    expect(document.warnings).toEqual([
      'Lines that repeat on most pages, such as page headers and footers, were left out: "Tri-County Office of Neighborhood Opportunity" and "Page 1 of 4".',
    ]);
  });

  it('finds them by where they sit when a file draws them after the body', async () => {
    const pages = [1, 2, 3, 4].map((page): Run[] => [
      ...content(page),
      { text: 'Tri-County Office of Neighborhood Opportunity', y: 760, size: 9 },
      { text: 'Draft for board review', y: 52, size: 9 },
      { text: `Page ${page}`, y: 38, size: 9 },
    ]);
    const document = await extractPdf(buildPdf(pages));
    expect(document.blocks).toHaveLength(24);
    expect(texts(document).join(' ')).not.toMatch(/Tri-County|Draft for board review|Page \d/);
  });

  it('finds a watermark by its place in the file, wherever it sits on the page', async () => {
    const pages = [1, 2, 3, 4].map((page): Run[] => [{ text: 'DRAFT - NOT FOR DISTRIBUTION', y: 610, size: 30 }, ...content(page)]);
    const document = await extractPdf(buildPdf(pages));
    expect(document.blocks).toHaveLength(24);
    // Left in, its large type would have made it the heading above everything.
    expect(document.blocks.every((entry) => entry.kind === 'paragraph' && entry.section === '')).toBe(true);
    expect(document.warnings).toEqual([
      'Lines that repeat on most pages, such as page headers and footers, were left out: "DRAFT - NOT FOR DISTRIBUTION".',
    ]);
  });

  it('names only the first few when many lines were left out', async () => {
    const pages = [1, 2, 3, 4].map((page): Run[] => [
      { text: 'Tri-County Office', y: 770, size: 9 },
      { text: 'Notice of Funding Availability', y: 758, size: 9 },
      ...content(page),
      { text: 'Draft for board review', y: 52, size: 9 },
      { text: 'Not for distribution', y: 40, size: 9 },
    ]);
    const document = await extractPdf(buildPdf(pages));
    expect(document.blocks).toHaveLength(24);
    expect(document.warnings).toEqual([
      'Lines that repeat on most pages, such as page headers and footers, were left out: "Tri-County Office", "Notice of Funding Availability", "Draft for board review" and 1 more.',
    ]);
  });

  it('drops bare page numbers without a warning', async () => {
    const numbered = [1, 2, 3, 4].map((page) => [...content(page), { text: String(page), y: 40, size: 9 }]);
    const document = await extractPdf(buildPdf(numbered));
    expect(document.blocks).toHaveLength(24);
    expect(document.warnings).toEqual([]);
  });

  it('never trims a short page', async () => {
    const short = [1, 2, 3, 4].map((page) => withFurniture(page, content(page).slice(0, 3)));
    const document = await extractPdf(buildPdf(short));
    expect(texts(document).filter((text) => text.startsWith('Tri-County'))).toHaveLength(4);
    expect(document.warnings).toEqual([]);
  });

  it('never removes a large share of a page, so a form that starts every page alike keeps its text', async () => {
    const form = [1, 2, 3].map((page): Run[] => [
      { text: 'Applicant organization and employer identification number as registered', y: 760 },
      { text: 'Authorized representative, title, telephone number and email address', y: 720 },
      ...Array.from({ length: 4 }, (_, line) => ({ text: `Answer ${page}.${line + 1}`, y: 680 - line * 40 })),
    ]);
    const document = await extractPdf(buildPdf(form));
    expect(texts(document).filter((text) => text.startsWith('Applicant organization'))).toHaveLength(3);
    expect(document.warnings).toEqual([]);
  });

  it('keeps a line that repeats on fewer than most pages, such as a chapter title', async () => {
    const pages = [1, 2, 3, 4, 5, 6].map((page): Run[] => [
      ...(page <= 3 ? [{ text: 'Part One: Background', y: 760, size: 9 }] : []),
      ...Array.from({ length: 6 }, (_, line) => ({ text: `Sentence ${line + 1} on sheet ${'ABCDEF'[page - 1]} stands alone.`, y: 700 - line * 40 })),
    ]);
    const document = await extractPdf(buildPdf(pages));
    expect(texts(document).filter((text) => text === 'Part One: Background')).toHaveLength(3);
    expect(document.warnings).toEqual([]);
  });

  it('keeps a repeated line that is too long to be a header', async () => {
    const notice =
      'This notice is repeated at the head of every page because the funder requires applicants to read it before each section they complete.';
    expect(notice.length).toBeGreaterThan(120);
    const pages = [1, 2, 3, 4].map((page): Run[] => [
      { text: notice, y: 760, size: 6 },
      ...Array.from({ length: 6 }, (_, line) => ({
        text: `Sentence ${line + 1} of the body text on sheet ${'ABCD'[page - 1]} is a good deal longer than the others were.`,
        y: 700 - line * 40,
        size: 6,
      })),
    ]);
    const document = await extractPdf(buildPdf(pages));
    expect(texts(document).filter((text) => text === notice)).toHaveLength(4);
  });

  it('leaves out what the PDF itself marks as page furniture, however long, short-paged or rare it is', async () => {
    const notice =
      'This notice is repeated at the foot of every page because the funder requires applicants to read it before each section they complete.';
    const sentence = (page: number, line: number) =>
      `Sentence ${line} on sheet ${'AB'[page - 1]} is a long one, so that the furniture around it stays a small share of everything on the page.`;
    // Two pages of four lines each: too few pages, and pages too short, for the furniture to be found by repetition.
    const pages = [1, 2].map((page): Run[] => [
      { text: 'Tri-County Office of Neighborhood Opportunity', y: 760, size: 8, tag: 'Artifact' },
      ...[1, 2, 3, 4].map((line) => ({ text: sentence(page, line), y: 740 - line * 40, size: 8 })),
      { text: notice, y: 50, size: 6, tag: 'Artifact' },
      { text: `Page ${page}`, y: 36, size: 8, tag: 'Artifact' },
    ]);
    const document = await extractPdf(buildPdf(pages, { tagged: true }));
    expect(texts(document)).toEqual([1, 2].flatMap((page) => [1, 2, 3, 4].map((line) => sentence(page, line))));
    // It is the file's own statement, not a guess, so nothing is reported.
    expect(document.warnings).toEqual([]);

    // The same pages without the marking keep every line.
    const unmarked = await extractPdf(buildPdf(pages.map((runs) => runs.map((run) => ({ ...run, tag: undefined })))));
    expect(unmarked.blocks).toHaveLength(14);
  });

  it('does not believe a PDF that marks most of its text as page furniture', async () => {
    const pages = [1, 2].map((page): Run[] => [
      { text: `The whole of sheet ${'AB'[page - 1]} was marked as furniture by the program that made it.`, y: 700, tag: 'Artifact' },
      { text: 'Only this short line was not.', y: 660 },
    ]);
    const document = await extractPdf(buildPdf(pages, { tagged: true }));
    expect(document.blocks).toHaveLength(4);
    expect(texts(document)[0]).toBe('The whole of sheet A was marked as furniture by the program that made it.');
  });

  it('needs the line on at least three pages', async () => {
    const two = [1, 2].map((page) => withFurniture(page, content(page)));
    const document = await extractPdf(buildPdf(two));
    expect(texts(document).filter((text) => text.startsWith('Tri-County'))).toHaveLength(2);
  });
});

describe('nothing in a PDF is fetched or run', () => {
  it('opens every file with drawing, scripts and outside locations switched off', async () => {
    const { pdfjs, cMapUrl } = await loadPdfjs();
    const options = pdfOpenOptions(pdfjs, new Uint8Array([37, 80, 68, 70]), cMapUrl);
    expect(options).toEqual({
      data: new Uint8Array([37, 80, 68, 70]),
      verbosity: 0,
      cMapUrl,
      cMapPacked: true,
      enableXfa: false,
      disableFontFace: true,
      useSystemFonts: false,
      useWasm: false,
      isOffscreenCanvasSupported: false,
      isImageDecoderSupported: false,
      disableAutoFetch: true,
      disableRange: true,
      disableStream: true,
      stopAtErrors: false,
      isEvalSupported: false,
    });
    // The bytes are passed in, never a location; no font, WebAssembly or colour-profile folder is named.
    for (const key of ['url', 'range', 'standardFontDataUrl', 'wasmUrl', 'iccUrl', 'password', 'docBaseUrl']) {
      expect(options).not.toHaveProperty(key);
    }
    // The one path it is given is a folder inside its own package, written as a path and not a URL.
    expect(cMapUrl).toMatch(/pdfjs-dist[\\/]cmaps\/$/);
    expect(cMapUrl).not.toMatch(/^[a-z]+:\/\//i);
    expect(existsSync(cMapUrl)).toBe(true);
    expect(readdirSync(cMapUrl).some((name) => name.endsWith('.bcmap'))).toBe(true);
  });

  it('reads the text of a booby-trapped file without running its scripts or opening a connection', async () => {
    // Every outgoing connection, however it is made, goes through this one method.
    const connect = vi.spyOn(net.Socket.prototype, 'connect');
    const fetched = vi.spyOn(globalThis, 'fetch');
    const script = "globalThis.documentScriptRan = true; app.launchURL('http://tracker.invalid/opened', true);";

    const hostile = buildPdf([paragraph(['Eligible applicants are nonprofit organizations.'], 700)], {
      catalog: (add) => {
        const action = add(`<< /S /JavaScript /JS (${script.replace(/\(/g, '\\(').replace(/\)/g, '\\)')}) >>`);
        const xfa = Buffer.from('<xdp:xdp xmlns:xdp="http://ns.adobe.com/xdp/"><script>xfa.host.gotoURL("http://tracker.invalid/xfa")</script></xdp:xdp>');
        const form = add(`<< /Length ${xfa.length} >>`, xfa);
        const remote = add('<< /Type /Filespec /FS /URL /F (http://tracker.invalid/payload.bin) >>');
        return (
          `/OpenAction ${action} 0 R /AA << /WC ${action} 0 R >> ` +
          `/Names << /JavaScript << /Names [(start) ${action} 0 R] >> /EmbeddedFiles << /Names [(payload) ${remote} 0 R] >> >> ` +
          `/AcroForm << /XFA ${form} 0 R /Fields [] >> /URI << /Base (http://tracker.invalid/) >>`
        );
      },
      page: (add) => {
        const link = add(
          '<< /Type /Annot /Subtype /Link /Rect [0 0 612 792] /A << /S /URI /URI (http://tracker.invalid/clicked) >> >>',
        );
        const launch = add(
          '<< /Type /Annot /Subtype /Link /Rect [0 0 10 10] /A << /S /GoToR /F (http://tracker.invalid/other.pdf) /D [0 /Fit] >> >>',
        );
        const image = add(
          '<< /Type /XObject /Subtype /Image /Width 1 /Height 1 /ColorSpace /DeviceGray /BitsPerComponent 8 /F << /FS /URL /F (http://tracker.invalid/pixel.png) >> /Length 0 >>',
          Buffer.alloc(0),
        );
        return {
          entries: `/Annots [${link} 0 R ${launch} 0 R] /AA << /O << /S /JavaScript /JS (globalThis.documentScriptRan = true) >> >>`,
          resources: `/XObject << /Im1 ${image} 0 R >>`,
          content: 'q 10 0 0 10 0 0 cm /Im1 Do Q',
        };
      },
    });

    const document = await extractPdf(hostile);
    expect(texts(document)).toEqual(['Eligible applicants are nonprofit organizations.']);
    expect(connect).not.toHaveBeenCalled();
    expect(fetched).not.toHaveBeenCalled();
    expect((globalThis as { documentScriptRan?: boolean }).documentScriptRan).toBeUndefined();
    // The form it carries is reported as unread rather than expanded.
    expect(document.warnings).toEqual([expect.stringMatching(/fillable form fields/)]);
  });
});
