import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ data: { logins: [] as unknown[], neverSave: [] as string[] } as Record<string, unknown> }));
vi.mock('../storage/store.js', () => ({ createStore: () => ({
  get: (key: string) => state.data[key],
  set: (key: string, value: unknown) => { state.data[key] = value; },
}) }));
vi.mock('electron', () => ({ safeStorage: {
  isEncryptionAvailable: () => true,
  getSelectedStorageBackend: () => 'keychain',
  encryptString: (value: string) => Buffer.from(`secure:${value}`),
  decryptString: (value: Buffer) => {
    const text = value.toString();
    if (!text.startsWith('secure:')) throw new Error('unreadable');
    return text.slice(7);
  },
} }));

const { loginOrigin, parseCsv, passwordStore } = await import('./store.js');

beforeEach(() => { state.data = { logins: [], neverSave: [] }; });

describe('loginOrigin', () => {
  it('accepts https sites and this machine only', () => {
    expect(loginOrigin('https://portal.example.org/login?next=/')).toBe('https://portal.example.org');
    expect(loginOrigin('http://127.0.0.1:5173/sign-in')).toBe('http://127.0.0.1:5173');
    for (const url of ['http://example.org/login', 'file:///tmp/a.html', 'data:text/html,x', 'about:blank', 'nonsense']) {
      expect(loginOrigin(url), url).toBeNull();
    }
  });
});

describe('passwordStore', () => {
  it('encrypts passwords and never lists them', () => {
    expect(passwordStore.save('https://a.example', 'ana', 's3cret')).toBe('saved');
    const stored = JSON.stringify(state.data.logins);
    expect(stored).not.toContain('"s3cret"');
    expect(stored).toContain('v2:');
    expect(JSON.stringify(passwordStore.list())).not.toContain('s3cret');
    expect(passwordStore.list()).toEqual([expect.objectContaining({ origin: 'https://a.example', username: 'ana' })]);
  });

  it('updates a changed password and leaves an identical one alone', () => {
    passwordStore.save('https://a.example', 'ana', 'one');
    expect(passwordStore.save('https://a.example', 'ana', 'one')).toBe('unchanged');
    expect(passwordStore.save('https://a.example', 'ana', 'two')).toBe('updated');
    expect(passwordStore.has('https://a.example', 'ana', 'two')).toBe(true);
    expect(passwordStore.list()).toHaveLength(1);
  });

  it('gives a password only to the site it was saved for', () => {
    passwordStore.save('https://bank.example', 'ana', 'vault');
    const [login] = passwordStore.forOrigin('https://bank.example');
    expect(passwordStore.passwordFor(login!.id, 'https://evil.example')).toBeNull();
    expect(passwordStore.passwordFor(login!.id, 'https://bank.example')).toEqual({ username: 'ana', password: 'vault' });
  });

  it('remembers sites never to save for, until the person saves there', () => {
    passwordStore.neverSaveFor('https://a.example');
    expect(passwordStore.isNeverSaved('https://a.example')).toBe(true);
    passwordStore.save('https://a.example', 'ana', 'x');
    expect(passwordStore.isNeverSaved('https://a.example')).toBe(false);
  });

  it('refuses sites that are not secure', () => {
    expect(() => passwordStore.save('http://a.example', 'ana', 'x')).toThrow(/cannot be saved/);
  });

  it('imports Apple Passwords, Chrome and Firefox exports', () => {
    const apple = 'Title,URL,Username,Password,Notes,OTPAuth\n' +
      'Grants portal,https://grants.example.gov/login,ana@org.org,"pa,ss""word",,\n' +
      'Old site,http://insecure.example/,bob,pw,,\n' +
      'No password,https://x.example/,carl,,,\n';
    expect(passwordStore.importCsv(apple)).toEqual({ imported: 1, skipped: 2 });
    const [login] = passwordStore.forOrigin('https://grants.example.gov');
    expect(passwordStore.passwordFor(login!.id, 'https://grants.example.gov')?.password).toBe('pa,ss"word');

    const chrome = '﻿name,url,username,password,note\r\nportal,https://portal.example.org/,dee,secret,\r\n';
    expect(passwordStore.importCsv(chrome)).toEqual({ imported: 1, skipped: 0 });
    const firefox = '"url","username","password","httpRealm"\n"https://ff.example","eve","pw2",""\n';
    expect(passwordStore.importCsv(firefox)).toEqual({ imported: 1, skipped: 0 });
    expect(passwordStore.list().map((entry) => entry.origin)).toEqual(['https://ff.example', 'https://grants.example.gov', 'https://portal.example.org']);
  });

  it('rejects a file that is not a password export', () => {
    expect(() => passwordStore.importCsv('a,b\n1,2\n')).toThrow(/not a password export/);
  });
});

describe('parseCsv', () => {
  it('handles quotes, doubled quotes and newlines inside quotes', () => {
    expect(parseCsv('a,"b ""q""","c\nd"\n1,2,3')).toEqual([['a', 'b "q"', 'c\nd'], ['1', '2', '3']]);
  });
});
