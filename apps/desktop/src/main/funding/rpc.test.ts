import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BrowserWindow } from 'electron';
import { FUNDING_METHODS, type Organization, type Permission, type SessionInfo } from '../../shared/funding.js';

const handle = vi.fn();
const removeHandler = vi.fn();
vi.mock('electron', () => ({ ipcMain: { handle, removeHandler } }));

const { dispatchFundingCall, registerFundingRpc, sendFundingEvent, organizationOf } = await import('./rpc.js');
const { FundingError } = await import('./errors.js');

const ORG_A = '11111111-1111-4111-8111-111111111111';
const ORG_B = '22222222-2222-4222-8222-222222222222';
const organization = (id = ORG_A) => ({ id, name: 'Harbor Lantern Collective' }) as Organization;
const session = (organizationId: string | null = ORG_A) => ({ id: 's', userId: 'u', organizationId }) as SessionInfo;

const mainFrame = { name: 'main' };
const webContents = { mainFrame, send: vi.fn(), isDestroyed: () => false };
const window = { webContents, isDestroyed: () => false } as unknown as BrowserWindow;
const fromApp = { sender: webContents, senderFrame: mainFrame } as never;

function setup(options: { active?: string | null; allow?: (permission: Permission, organizationId?: string) => boolean } = {}) {
  const active = options.active === undefined ? ORG_A : options.active;
  const identity = {
    currentSession: vi.fn(async () => session(active)),
    requireOrganization: vi.fn(async () => {
      if (!active) throw new FundingError('ORGANIZATION_NOT_FOUND', 'Create or choose an organization first.');
      return { session: session(active), organization: organization(active) };
    }),
    authorize: vi.fn(async (permission: Permission, organizationId?: string) => {
      if (options.allow && !options.allow(permission, organizationId)) {
        throw new FundingError('FORBIDDEN', 'Your role in this organization does not allow that.');
      }
    }),
  };
  // A handler for every listed method that records what it was given.
  const calls: { namespace: string; method: string; organizationId: string | null; args: unknown[] }[] = [];
  const handlers = Object.fromEntries(
    Object.entries(FUNDING_METHODS).map(([namespace, methods]) => [
      namespace,
      Object.fromEntries(
        Object.keys(methods).map((method) => [
          method,
          (context: { organization: Organization | null }, ...args: unknown[]) => {
            calls.push({ namespace, method, organizationId: context.organization?.id ?? null, args });
            return `${namespace}.${method}`;
          },
        ]),
      ),
    ]),
  ) as never;
  const call = (namespace: unknown, method: unknown, args: unknown = [], event: unknown = fromApp) =>
    dispatchFundingCall({ window, handlers, identity }, event as never, namespace, method, args);
  return { identity, calls, call, handlers };
}

beforeEach(() => {
  handle.mockReset();
  removeHandler.mockReset();
  webContents.send.mockReset();
});

describe('the funding call door', () => {
  it('runs a listed call for the active organization and wraps the value', async () => {
    const { call, calls, identity } = setup();
    expect(await call('knowledge', 'listDocuments')).toEqual({ ok: true, value: 'knowledge.listDocuments' });
    expect(calls).toEqual([{ namespace: 'knowledge', method: 'listDocuments', organizationId: ORG_A, args: [] }]);
    expect(identity.authorize).toHaveBeenCalledWith('knowledge.read', ORG_A);
  });

  it('checks the permission of every call that has one, against the active organization', async () => {
    const { call, identity } = setup();
    for (const [namespace, methods] of Object.entries(FUNDING_METHODS)) {
      for (const [method, permission] of Object.entries(methods)) {
        identity.authorize.mockClear();
        const args = namespace === 'identity' && ['updateOrganization', 'deleteOrganization'].includes(method) ? [ORG_B] : [];
        const outcome = await call(namespace, method, args);
        expect(outcome, `${namespace}.${method}`).toMatchObject({ ok: true });
        if (permission) {
          const target = args[0] ?? ORG_A;
          expect(identity.authorize, `${namespace}.${method}`).toHaveBeenCalledWith(permission, target);
        } else {
          expect(identity.authorize, `${namespace}.${method}`).not.toHaveBeenCalled();
        }
      }
    }
  });

  it('refuses a call the role does not allow, before the handler runs', async () => {
    const { call, calls } = setup({ allow: (permission) => permission.endsWith('.read') });
    expect(await call('knowledge', 'deleteDocument', ['doc'])).toEqual({
      ok: false,
      error: { code: 'FORBIDDEN', message: 'Your role in this organization does not allow that.' },
    });
    expect(await call('knowledge', 'approveClaims', [['c1']])).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    expect(await call('knowledge', 'listDocuments')).toMatchObject({ ok: true });
    expect(calls.map((entry) => entry.method)).toEqual(['listDocuments']);
  });

  it('authorizes calls that name an organization against that organization, not the active one', async () => {
    const { call, identity, calls } = setup({ allow: (_permission, organizationId) => organizationId === ORG_A });
    expect(await call('identity', 'deleteOrganization', [ORG_B])).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    expect(identity.authorize).toHaveBeenLastCalledWith('organization.manage', ORG_B);
    expect(await call('identity', 'deleteOrganization', ['../../other'])).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    expect(await call('identity', 'updateOrganization', [ORG_A, { name: 'New name' }])).toMatchObject({ ok: true });
    expect(calls).toHaveLength(1);
  });

  it('needs an active organization for organization work, and only for that', async () => {
    const { call, calls } = setup({ active: null });
    for (const [namespace, method] of [['knowledge', 'listDocuments'], ['rfps', 'list'], ['guides', 'list'], ['opportunities', 'search'], ['opportunities', 'listSaved']]) {
      expect(await call(namespace, method), `${namespace}.${method}`).toEqual({
        ok: false,
        error: { code: 'ORGANIZATION_NOT_FOUND', message: 'Create or choose an organization first.' },
      });
    }
    for (const [namespace, method] of [['identity', 'get'], ['identity', 'createOrganization'], ['opportunities', 'sources'], ['opportunities', 'portals'], ['jobs', 'list']]) {
      expect(await call(namespace, method), `${namespace}.${method}`).toMatchObject({ ok: true });
    }
    expect(calls.every((entry) => entry.organizationId === null)).toBe(true);
  });

  it('refuses anything that does not come from the top frame of the app window', async () => {
    const { call, calls } = setup();
    const otherContents = { mainFrame: {} };
    const refusals = [
      { sender: otherContents, senderFrame: otherContents.mainFrame }, // a web page's own contents
      { sender: webContents, senderFrame: { name: 'embedded frame' } }, // a frame inside the app window
      { sender: webContents, senderFrame: null },
    ];
    for (const event of refusals) {
      expect(await call('identity', 'get', [], event)).toEqual({
        ok: false,
        error: { code: 'FORBIDDEN', message: 'This is only available in the app.' },
      });
    }
    expect(calls).toEqual([]);
  });

  it('refuses unknown or malformed calls, including inherited property names', async () => {
    const { call, calls } = setup();
    const bad: [unknown, unknown, unknown][] = [
      ['knowledge', 'dropEverything', []],
      ['nope', 'get', []],
      ['__proto__', 'constructor', []],
      ['knowledge', 'constructor', []],
      ['knowledge', 'toString', []],
      ['onEvent', 'call', []],
      [42, 'get', []],
      ['identity', null, []],
      ['identity', 'get', 'not-an-array'],
      ['identity', 'get', new Array(7).fill(0)],
    ];
    for (const [namespace, method, args] of bad) {
      expect(await call(namespace, method, args), JSON.stringify([namespace, method])).toMatchObject({
        ok: false,
        error: { code: 'INVALID_INPUT' },
      });
    }
    expect(calls).toEqual([]);
  });

  it('never lets an unexpected failure leak its details', async () => {
    const { handlers, identity } = setup();
    (handlers as unknown as { knowledge: { search: () => never } }).knowledge.search = () => {
      throw new Error('EACCES: /Users/someone/Library/Application Support/secret.json sk-ant-xyz');
    };
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    const outcome = await dispatchFundingCall({ window, handlers, identity }, fromApp, 'knowledge', 'search', ['mission']);
    quiet.mockRestore();
    expect(outcome).toEqual({ ok: false, error: { code: 'INTERNAL', message: 'Something went wrong. Please try again.' } });
  });

  it('refuses everything once the window is gone', async () => {
    const { handlers, identity } = setup();
    const gone = { webContents, isDestroyed: () => true } as unknown as BrowserWindow;
    expect(await dispatchFundingCall({ window: gone, handlers, identity }, fromApp, 'identity', 'get', [])).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    expect(await dispatchFundingCall({ window: null, handlers, identity }, fromApp, 'identity', 'get', [])).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
  });
});

describe('registration and events', () => {
  it('replaces an earlier registration and looks the window up on every call', async () => {
    const { handlers, identity } = setup();
    let current: BrowserWindow | null = null;
    registerFundingRpc({ getWindow: () => current, handlers, identity });
    registerFundingRpc({ getWindow: () => current, handlers, identity });
    expect(removeHandler).toHaveBeenCalledTimes(2);
    expect(handle).toHaveBeenCalledTimes(2);
    const registered = handle.mock.calls.at(-1)![1] as (...args: unknown[]) => Promise<unknown>;
    expect(await registered(fromApp, 'identity', 'get', [])).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    current = window;
    expect(await registered(fromApp, 'identity', 'get', [])).toMatchObject({ ok: true });
  });

  it('sends events only to a live window', () => {
    sendFundingEvent(window, { kind: 'identity_changed' });
    expect(webContents.send).toHaveBeenCalledWith('funding:event', { kind: 'identity_changed' });
    sendFundingEvent(null, { kind: 'identity_changed' });
    sendFundingEvent({ isDestroyed: () => true } as unknown as BrowserWindow, { kind: 'identity_changed' });
    expect(webContents.send).toHaveBeenCalledTimes(1);
  });

  it('gives handlers the active organization or a clear error', () => {
    expect(organizationOf({ window, session: session(), organization: organization() }).id).toBe(ORG_A);
    expect(() => organizationOf({ window, session: session(null), organization: null })).toThrow('Create or choose an organization first.');
  });
});
