import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { listeners, handlers, tab, store } = vi.hoisted(() => ({
  listeners: new Map<string, (...args: unknown[]) => void>(),
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  tab: { id: 'tab-1', webContents: { id: 7, getURL: () => 'https://portal.example.org/login', send: () => {} } },
  store: {
    list: () => [],
    forOrigin: () => [],
    has: () => false,
    save: () => 'saved',
    passwordFor: () => null,
    remove: () => {},
    isNeverSaved: () => false,
    neverSaveFor: () => {},
    importCsv: () => ({ imported: 0, skipped: 0 }),
  },
}));

vi.mock('electron', () => ({
  dialog: { showOpenDialog: vi.fn() },
  Menu: { buildFromTemplate: vi.fn(() => ({ popup: vi.fn() })) },
  ipcMain: {
    on: (channel: string, listener: (...args: unknown[]) => void) => listeners.set(channel, listener),
    off: (channel: string) => listeners.delete(channel),
  },
}));
vi.mock('../tabs/manager.js', () => ({
  tabManager: {
    idForWebContents: (id: number) => (id === tab.webContents.id ? tab.id : null),
    getView: (id: string) => (id === tab.id ? { webContents: tab.webContents } : undefined),
    getActiveId: () => tab.id,
    onMainFrameNavigate: () => () => {},
  },
}));
vi.mock('../storage/store.js', () => ({ createStore: () => ({ get: () => [], set: () => {} }) }));
vi.mock('./store.js', async (importOriginal) => ({
  loginOrigin: (await importOriginal<typeof import('./store.js')>()).loginOrigin,
  passwordStore: store,
}));

const { registerPasswordIpc } = await import('./service.js');

const mainFrame = { parent: null };
const win = { isDestroyed: () => false, webContents: { mainFrame, send: vi.fn() } };
const fromApp = { sender: win.webContents, senderFrame: mainFrame };
let release: () => void;

beforeEach(() => {
  vi.useFakeTimers();
  handlers.clear();
  listeners.clear();
  release = registerPasswordIpc(win as never, ((channel: string, listener: (...args: unknown[]) => unknown) => {
    handlers.set(channel, listener);
  }) as never);
});

afterEach(() => {
  release();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const call = (channel: string, event: unknown, ...args: unknown[]) => handlers.get(channel)!(event, ...args);

function submitSignIn(): string {
  listeners.get('password:submitted')!(
    { sender: tab.webContents, senderFrame: { url: 'https://portal.example.org/login', parent: null } },
    { username: 'ana@org.org', password: 'hunter2-secret' },
  );
  const offer = win.webContents.send.mock.calls.findLast(([channel]) => channel === 'password:offer')?.[1] as { id: string };
  return offer.id;
}

describe('saved password IPC', () => {
  it('refuses requests that do not come from the app window', async () => {
    const page = { sender: tab.webContents, senderFrame: { parent: null } };
    const list = vi.spyOn(store, 'list');
    const remove = vi.spyOn(store, 'remove');
    for (const channel of ['password:list', 'password:delete', 'password:import', 'password:fill-request', 'password:state-get', 'password:offer-reply']) {
      expect(() => call(channel, page, 'tab-1'), channel).toThrow('only available from the app window');
    }
    // A child frame of the app window is not the app either.
    expect(() => call('password:list', { sender: win.webContents, senderFrame: { parent: mainFrame } })).toThrow('only available');
    expect(list).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
    expect(call('password:list', fromApp)).toEqual([]);
    expect(list).toHaveBeenCalledOnce();
  });

  it('forgets an unanswered offer, and its password, once it expires', async () => {
    const save = vi.spyOn(store, 'save');
    const id = submitSignIn();
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(vi.getTimerCount()).toBe(0);
    expect(call('password:offer-reply', fromApp, id, 'save')).toBe('expired');
    expect(save).not.toHaveBeenCalled();
  });

  it('still saves an offer answered in time', () => {
    const save = vi.spyOn(store, 'save');
    const id = submitSignIn();
    expect(call('password:offer-reply', fromApp, id, 'save')).toBe('done');
    expect(save).toHaveBeenCalledWith('https://portal.example.org', 'ana@org.org', 'hunter2-secret');
    expect(vi.getTimerCount()).toBe(0);
  });
});
