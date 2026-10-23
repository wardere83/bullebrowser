import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

let userData: string;
vi.mock('electron', () => ({ app: { getPath: () => userData } }));

const { assertUuid, isUuid, orgPath, organizationsRoot, readJson, removeOrganizationData, writeJson } =
  await import('./org-store.js');

const ORG_A = '11111111-1111-4111-8111-111111111111';
const ORG_B = '22222222-2222-4222-8222-222222222222';

beforeEach(() => {
  userData = mkdtempSync(join(tmpdir(), 'bb-org-store-'));
});

describe('organization paths', () => {
  it('keeps each organization in its own directory', () => {
    expect(orgPath(ORG_A, 'knowledge', 'documents.json')).toBe(
      join(userData, 'organizations', ORG_A, 'knowledge', 'documents.json'),
    );
    expect(orgPath(ORG_A)).not.toBe(orgPath(ORG_B));
    expect(orgPath(ORG_B, 'knowledge').startsWith(orgPath(ORG_A))).toBe(false);
  });

  it('refuses anything that is not a UUID as an organization id', () => {
    for (const id of ['', '..', '../' + ORG_B, `${ORG_A}/../${ORG_B}`, 'not-a-uuid', ORG_A + ' ', '/etc']) {
      expect(isUuid(id)).toBe(false);
      expect(() => orgPath(id, 'knowledge')).toThrow(/not valid/);
    }
    expect(() => assertUuid(42, 'document')).toThrow('That document is not valid.');
    expect(assertUuid(ORG_A)).toBe(ORG_A);
  });

  it('refuses segments that could leave the organization directory', () => {
    for (const segment of ['..', '../other', 'a/b', 'a\\b', '', '.hidden', '..%2f', 'x'.repeat(200), `..${ORG_B}`]) {
      expect(() => orgPath(ORG_A, segment)).toThrow(/not valid/);
    }
    expect(() => orgPath(ORG_A, 'knowledge', '..', '..', ORG_B)).toThrow(/not valid/);
  });
});

describe('JSON files', () => {
  it('returns the fallback for a missing file and round-trips a written one', async () => {
    const file = orgPath(ORG_A, 'knowledge', 'documents.json');
    expect(await readJson(file, { documents: [] })).toEqual({ documents: [] });
    await writeJson(file, { documents: [{ id: 1 }] });
    expect(await readJson(file, null)).toEqual({ documents: [{ id: 1 }] });
    // No temporary files are left behind.
    expect(readdirSync(orgPath(ORG_A, 'knowledge'))).toEqual(['documents.json']);
  });

  it('moves an unreadable file aside instead of deleting or overwriting it', async () => {
    const file = orgPath(ORG_A, 'profile.json');
    await writeJson(file, { ok: true });
    writeFileSync(file, '{ "claims": [ truncated');
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await readJson(file, { claims: [] })).toEqual({ claims: [] });
    quiet.mockRestore();
    const names = readdirSync(orgPath(ORG_A));
    expect(names.some((name) => name.startsWith('profile.json.unreadable-'))).toBe(true);
    const aside = names.find((name) => name.startsWith('profile.json.unreadable-'))!;
    expect(readFileSync(join(orgPath(ORG_A), aside), 'utf8')).toBe('{ "claims": [ truncated');
  });

  it('applies concurrent writes to one file in the order they were made', async () => {
    const file = orgPath(ORG_A, 'activity.json');
    await Promise.all(Array.from({ length: 25 }, (_, n) => writeJson(file, { n })));
    expect(await readJson(file, null)).toEqual({ n: 24 });
    expect(readdirSync(orgPath(ORG_A))).toEqual(['activity.json']);
  });

  it('keeps writing after one write fails', async () => {
    const file = orgPath(ORG_A, 'state.json');
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    await expect(writeJson(file, circular)).rejects.toThrow();
    await writeJson(file, { recovered: true });
    expect(await readJson(file, null)).toEqual({ recovered: true });
  });
});

describe('removing an organization', () => {
  it('deletes only that organization', async () => {
    await writeJson(orgPath(ORG_A, 'knowledge', 'documents.json'), { a: 1 });
    await writeJson(orgPath(ORG_B, 'knowledge', 'documents.json'), { b: 1 });
    await removeOrganizationData(ORG_A);
    expect(existsSync(orgPath(ORG_A))).toBe(false);
    expect(await readJson(orgPath(ORG_B, 'knowledge', 'documents.json'), null)).toEqual({ b: 1 });
    expect(readdirSync(organizationsRoot())).toEqual([ORG_B]);
    await expect(removeOrganizationData('../' + ORG_B)).rejects.toThrow(/not valid/);
  });
});
