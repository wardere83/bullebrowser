import { existsSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExtractedBlock, ExtractedDocument } from '../documents/types.js';

let userData: string;
vi.mock('electron', () => ({ app: { getPath: () => userData } }));

const { DocumentLibrary, displayName, formatFromName } = await import('./document-library.js');
const { FundingError } = await import('./errors.js');
const { orgPath } = await import('./org-store.js');

const ORG_A = '11111111-1111-4111-8111-111111111111';
const ORG_B = '22222222-2222-4222-8222-222222222222';
const USER = '99999999-9999-4999-8999-999999999999';

const block = (id: string, text: string): ExtractedBlock => ({ id, kind: 'paragraph', text, page: 1, section: '', headingLevel: null });
const extracted = (text: string): ExtractedDocument => ({
  format: 'txt',
  blocks: [block('b0001', text)],
  pageCount: null,
  wordCount: text.split(' ').length,
  warnings: [],
});

let sources: string;
const file = (name: string, content: string) => {
  const path = join(sources, name);
  writeFileSync(path, content);
  return path;
};

function library(overrides: Partial<ConstructorParameters<typeof DocumentLibrary<{ category: string }>>[0]> = {}) {
  const processed: { id: string; status: string; blocks: number | null; replaced: boolean }[] = [];
  const removed: string[] = [];
  const changes: string[] = [];
  const shelf = new DocumentLibrary<{ category: string }>({
    area: 'knowledge',
    extract: async (path) => extracted(`text of ${path.split('/').pop()}`),
    onChange: (organizationId) => changes.push(organizationId),
    onProcessed: (record, blocks, replaced) => {
      processed.push({ id: record.id, status: record.status, blocks: blocks ? blocks.length : null, replaced });
    },
    onRemoved: (record) => {
      removed.push(record.id);
    },
    ...overrides,
  });
  return { shelf, processed, removed, changes };
}

beforeEach(() => {
  userData = mkdtempSync(join(tmpdir(), 'bb-library-'));
  sources = mkdtempSync(join(tmpdir(), 'bb-library-src-'));
});

describe('adding a file', () => {
  it('copies it, reads it and reports each stage', async () => {
    const { shelf, processed, changes } = library();
    const added = await shelf.addFile(ORG_A, { sourcePath: file('Plan.txt', 'our mission'), uploadedBy: USER, extra: { category: 'strategic_plan' } });
    expect(added).toMatchObject({ name: 'Plan.txt', format: 'txt', status: 'queued', version: 1, organizationId: ORG_A, category: 'strategic_plan', uploadedBy: USER });
    expect(added.sha256).toMatch(/^[0-9a-f]{64}$/);

    await shelf.whenIdle(ORG_A);
    const [ready] = await shelf.list(ORG_A);
    expect(ready).toMatchObject({ status: 'ready', blockCount: 1, statusDetail: '' });
    expect(await shelf.blocks(ORG_A, added.id)).toEqual([expect.objectContaining({ id: 'b0001' })]);
    expect(processed).toEqual([{ id: added.id, status: 'ready', blocks: 1, replaced: false }]);
    expect(new Set(changes)).toEqual(new Set([ORG_A]));
    expect(existsSync(orgPath(ORG_A, 'knowledge', 'files', added.id))).toBe(true);
  });

  it('refuses unsupported, empty, missing and oversized files with a reason the user can act on', async () => {
    const { shelf } = library();
    const add = (sourcePath: string) => shelf.addFile(ORG_A, { sourcePath, uploadedBy: USER, extra: { category: 'other' } });
    await expect(add(file('budget.xlsx', 'x'))).rejects.toMatchObject({ code: 'UNSUPPORTED_FILE', message: expect.stringContaining('PDF, DOCX, TXT or Markdown') });
    await expect(add(file('empty.txt', ''))).rejects.toMatchObject({ code: 'EXTRACTION_FAILED' });
    await expect(add(join(sources, 'gone.pdf'))).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(add(sources + '/')).rejects.toBeInstanceOf(FundingError);
    expect(await shelf.list(ORG_A)).toEqual([]);
    // Nothing was left on the shelf by the refused files.
    expect(existsSync(orgPath(ORG_A, 'knowledge', 'files'))).toBe(false);
  });

  it('does not shelve the same file twice', async () => {
    const { shelf } = library();
    const first = await shelf.addFile(ORG_A, { sourcePath: file('a.txt', 'same words'), uploadedBy: USER, extra: { category: 'other' } });
    const second = await shelf.addFile(ORG_A, { sourcePath: file('copy of a.txt', 'same words'), uploadedBy: USER, extra: { category: 'other' } });
    expect(second.id).toBe(first.id);
    await shelf.whenIdle(ORG_A);
    expect(await shelf.list(ORG_A)).toHaveLength(1);
    expect(readdirSync(orgPath(ORG_A, 'knowledge', 'files'))).toEqual([first.id]);
  });

  it('records why a file could not be read, without leaking internals', async () => {
    const reasons: unknown[] = [new FundingError('EXTRACTION_FAILED', 'This PDF is password-protected.'), new Error('ENOENT /Users/someone/secret/path')];
    const { shelf, processed } = library({
      extract: async () => {
        throw reasons.shift();
      },
    });
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    const a = await shelf.addFile(ORG_A, { sourcePath: file('locked.pdf', '%PDF-1'), uploadedBy: USER, extra: { category: 'other' } });
    const b = await shelf.addFile(ORG_A, { sourcePath: file('odd.pdf', '%PDF-2'), uploadedBy: USER, extra: { category: 'other' } });
    await shelf.whenIdle(ORG_A);
    quiet.mockRestore();
    expect(await shelf.get(ORG_A, a.id)).toMatchObject({ status: 'failed', statusDetail: 'This PDF is password-protected.' });
    const other = await shelf.get(ORG_A, b.id);
    expect(other).toMatchObject({ status: 'failed' });
    expect(other!.statusDetail).not.toMatch(/ENOENT|Users|secret/);
    expect(await shelf.blocks(ORG_A, a.id)).toBeNull();
    expect(processed.map((entry) => entry.blocks)).toEqual([null, null]);
  });

  it('treats a file with no readable text as failed', async () => {
    const { shelf } = library({ extract: async () => ({ ...extracted('x'), blocks: [] }) });
    const added = await shelf.addFile(ORG_A, { sourcePath: file('blank.txt', '   '), uploadedBy: USER, extra: { category: 'other' } });
    await shelf.whenIdle(ORG_A);
    expect(await shelf.get(ORG_A, added.id)).toMatchObject({ status: 'failed', statusDetail: 'No readable text was found in this file.' });
  });
});

describe('replacing, retrying and removing', () => {
  it('replaces the file, raises the version and drops the old text first', async () => {
    const { shelf, processed } = library();
    const added = await shelf.addFile(ORG_A, { sourcePath: file('plan.txt', 'version one'), uploadedBy: USER, extra: { category: 'strategic_plan' } });
    await shelf.whenIdle(ORG_A);
    const replaced = await shelf.replaceFile(ORG_A, added.id, { sourcePath: file('plan-2026.txt', 'version two') });
    expect(replaced).toMatchObject({ id: added.id, version: 2, name: 'plan-2026.txt', status: 'queued', category: 'strategic_plan' });
    // Between the replace and the new read, nothing of the old version can be served.
    expect(await shelf.blocks(ORG_A, added.id)).toBeNull();
    await shelf.whenIdle(ORG_A);
    expect(await shelf.get(ORG_A, added.id)).toMatchObject({ status: 'ready', version: 2 });
    expect(processed.at(-1)).toEqual({ id: added.id, status: 'ready', blocks: 1, replaced: true });
    expect(readdirSync(orgPath(ORG_A, 'knowledge', 'files'))).toEqual([added.id]);
  });

  it('leaves the document untouched when the "new" file is identical', async () => {
    const { shelf } = library();
    const added = await shelf.addFile(ORG_A, { sourcePath: file('plan.txt', 'same'), uploadedBy: USER, extra: { category: 'other' } });
    await shelf.whenIdle(ORG_A);
    const again = await shelf.replaceFile(ORG_A, added.id, { sourcePath: file('plan again.txt', 'same') });
    expect(again).toMatchObject({ version: 1, status: 'ready' });
  });

  it('refuses a replacement that duplicates another document', async () => {
    const { shelf } = library();
    const a = await shelf.addFile(ORG_A, { sourcePath: file('a.txt', 'alpha'), uploadedBy: USER, extra: { category: 'other' } });
    await shelf.addFile(ORG_A, { sourcePath: file('b.txt', 'beta'), uploadedBy: USER, extra: { category: 'other' } });
    await shelf.whenIdle(ORG_A);
    await expect(shelf.replaceFile(ORG_A, a.id, { sourcePath: file('c.txt', 'beta') })).rejects.toThrow('already here as "b.txt"');
    expect(await shelf.get(ORG_A, a.id)).toMatchObject({ version: 1, status: 'ready' });
  });

  it('retries a failed read and updates extra fields', async () => {
    let attempts = 0;
    const { shelf } = library({
      extract: async () => {
        attempts += 1;
        if (attempts === 1) throw new FundingError('EXTRACTION_FAILED', 'Reading this file took too long.');
        return extracted('second time');
      },
    });
    const added = await shelf.addFile(ORG_A, { sourcePath: file('slow.txt', 'slow'), uploadedBy: USER, extra: { category: 'other' } });
    await shelf.whenIdle(ORG_A);
    expect((await shelf.get(ORG_A, added.id))!.status).toBe('failed');
    await shelf.retry(ORG_A, added.id);
    await shelf.whenIdle(ORG_A);
    expect((await shelf.get(ORG_A, added.id))!.status).toBe('ready');
    expect(await shelf.update(ORG_A, added.id, { category: 'budget' })).toMatchObject({ category: 'budget', status: 'ready' });
  });

  it('removes the document, its file and its text, and says so', async () => {
    const { shelf, removed } = library();
    const added = await shelf.addFile(ORG_A, { sourcePath: file('old.txt', 'old words'), uploadedBy: USER, extra: { category: 'other' } });
    await shelf.whenIdle(ORG_A);
    await shelf.remove(ORG_A, added.id);
    expect(await shelf.list(ORG_A)).toEqual([]);
    expect(await shelf.blocks(ORG_A, added.id)).toBeNull();
    expect(readdirSync(orgPath(ORG_A, 'knowledge', 'files'))).toEqual([]);
    expect(readdirSync(orgPath(ORG_A, 'knowledge', 'text'))).toEqual([]);
    expect(removed).toEqual([added.id]);
    await expect(shelf.remove(ORG_A, added.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('discards a read that finishes after the document was removed', async () => {
    let release!: () => void;
    const { shelf, processed } = library({
      extract: () => new Promise((resolve) => { release = () => resolve(extracted('late')); }),
    });
    const added = await shelf.addFile(ORG_A, { sourcePath: file('late.txt', 'late'), uploadedBy: USER, extra: { category: 'other' } });
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    await shelf.remove(ORG_A, added.id);
    release();
    await shelf.whenIdle(ORG_A);
    expect(await shelf.list(ORG_A)).toEqual([]);
    expect(processed).toEqual([]);
    expect(existsSync(orgPath(ORG_A, 'knowledge', 'text', `${added.id}.json`))).toBe(false);
  });
});

describe('organizations stay apart', () => {
  it('never lists, reads or removes across organizations', async () => {
    const { shelf } = library();
    const mine = await shelf.addFile(ORG_A, { sourcePath: file('a.txt', 'alpha only'), uploadedBy: USER, extra: { category: 'other' } });
    await shelf.addFile(ORG_B, { sourcePath: file('b.txt', 'beta only'), uploadedBy: USER, extra: { category: 'other' } });
    await Promise.all([shelf.whenIdle(ORG_A), shelf.whenIdle(ORG_B)]);

    expect((await shelf.list(ORG_A)).map((d) => d.name)).toEqual(['a.txt']);
    expect((await shelf.list(ORG_B)).map((d) => d.name)).toEqual(['b.txt']);
    // A valid id from one organization is simply not found in another.
    expect(await shelf.get(ORG_B, mine.id)).toBeNull();
    expect(await shelf.blocks(ORG_B, mine.id)).toBeNull();
    await expect(shelf.remove(ORG_B, mine.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(shelf.replaceFile(ORG_B, mine.id, { sourcePath: file('x.txt', 'x') })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect((await shelf.get(ORG_A, mine.id))!.status).toBe('ready');
  });

  it('ignores rows in a registry that belong to another organization', async () => {
    const { shelf } = library();
    const mine = await shelf.addFile(ORG_A, { sourcePath: file('a.txt', 'alpha'), uploadedBy: USER, extra: { category: 'other' } });
    await shelf.whenIdle(ORG_A);
    const { writeJson } = await import('./org-store.js');
    await writeJson(orgPath(ORG_B, 'knowledge', 'documents.json'), { schemaVersion: 1, documents: [await shelf.get(ORG_A, mine.id)] });
    expect(await shelf.list(ORG_B)).toEqual([]);
  });

  it('refuses malformed ids before touching the disk', async () => {
    const { shelf } = library();
    await expect(shelf.get(ORG_A, '../../etc/passwd')).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(shelf.list('../' + ORG_B)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(shelf.remove(ORG_A, `${ORG_B}/../x`)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });
});

describe('recovery and ready-made text', () => {
  it('picks up documents an earlier run left half-read', async () => {
    const first = library({ extract: () => new Promise(() => {}) });
    const added = await first.shelf.addFile(ORG_A, { sourcePath: file('big.txt', 'big'), uploadedBy: USER, extra: { category: 'other' } });
    await vi.waitFor(async () => expect((await first.shelf.get(ORG_A, added.id))!.status).toBe('extracting'));

    // A new run of the app: a fresh shelf over the same directory.
    const second = library();
    await second.shelf.list(ORG_A);
    await second.shelf.whenIdle(ORG_A);
    expect((await second.shelf.get(ORG_A, added.id))!.status).toBe('ready');
  });

  it('shelves text that needs no reading, ready at once', async () => {
    const { shelf, processed } = library();
    const added = await shelf.addExtracted(ORG_A, {
      name: 'Official listing: Workforce Pathways',
      uploadedBy: USER,
      extra: { category: 'other' },
      document: extracted('Awards range from $75,000 to $250,000.'),
    });
    expect(added).toMatchObject({ status: 'ready', blockCount: 1, version: 1 });
    expect(await shelf.blocks(ORG_A, added.id)).toHaveLength(1);
    expect(processed).toEqual([{ id: added.id, status: 'ready', blocks: 1, replaced: false }]);
  });
});

describe('names and formats', () => {
  it('reads the format from the extension only for the four accepted types', () => {
    expect(formatFromName('Plan.PDF')).toBe('pdf');
    expect(formatFromName('notes.markdown')).toBe('md');
    expect(formatFromName('profile.docx')).toBe('docx');
    for (const name of ['legacy.doc', 'sheet.xlsx', 'archive.zip', 'noextension', 'evil.pdf.exe']) {
      expect(formatFromName(name)).toBeNull();
    }
  });

  it('shows the file name without directories or hidden characters', () => {
    expect(displayName('/Users/me/Documents/Strategic Plan.pdf')).toBe('Strategic Plan.pdf');
    expect(displayName(`re${String.fromCodePoint(0x202e)}fdp.exe`)).toBe('refdp.exe');
    expect(displayName('   ')).toBe('Untitled document');
  });
});
