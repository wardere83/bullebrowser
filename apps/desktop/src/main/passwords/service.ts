// Saved passwords between web pages (src/preload/tab.ts) and BulleBrowser's
// own controls. The page's site is always read from the page's own frame
// here, never taken from what the page says, and a password is only ever
// filled into the exact site it was saved for.

import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dialog, ipcMain, Menu, type BrowserWindow, type IpcMainEvent } from 'electron';
import { IPC, type PasswordOffer, type PasswordState } from '../../shared/ipc.js';
import { tabManager } from '../tabs/manager.js';
import { loginOrigin, passwordStore } from './store.js';

interface PendingOffer { origin: string; username: string; password: string; tabId: string; expires: number }

const OFFER_LIFETIME_MS = 5 * 60_000;

export function registerPasswordIpc(win: BrowserWindow, handle: typeof ipcMain.handle): () => void {
  const offers = new Map<string, PendingOffer>();
  const forms = new Map<string, boolean>();

  const send = (channel: string, payload: unknown) => {
    if (!win.isDestroyed()) win.webContents.send(channel, payload);
  };

  /** Which tab a page message came from, and that page's site, from its own frame. */
  const sourceOf = (event: IpcMainEvent): { tabId: string; origin: string | null } | null => {
    const tabId = tabManager.idForWebContents(event.sender.id);
    if (!tabId || !event.senderFrame || event.senderFrame.parent) return null;
    return { tabId, origin: loginOrigin(event.senderFrame.url) };
  };

  const publishState = (tabId: string) => {
    const url = tabManager.getView(tabId)?.webContents.getURL() ?? '';
    const origin = loginOrigin(url);
    const state: PasswordState = {
      tabId,
      origin,
      hasForm: forms.get(tabId) ?? false,
      logins: origin ? passwordStore.forOrigin(origin) : [],
    };
    send(IPC.PASSWORD_STATE, state);
  };

  const onForm = (event: IpcMainEvent, present: unknown) => {
    const source = sourceOf(event);
    if (!source) return;
    forms.set(source.tabId, present === true);
    publishState(source.tabId);
  };

  const onSubmitted = (event: IpcMainEvent, payload: unknown) => {
    const source = sourceOf(event);
    const { username, password } = (payload ?? {}) as { username?: unknown; password?: unknown };
    if (!source?.origin || typeof username !== 'string' || typeof password !== 'string' || !password) return;
    if (password.length > 1024 || username.length > 256) return;
    if (passwordStore.isNeverSaved(source.origin) || passwordStore.has(source.origin, username, password)) return;
    const now = Date.now();
    for (const [id, offer] of offers) if (offer.expires < now) offers.delete(id);
    const id = randomUUID();
    offers.set(id, { origin: source.origin, username, password, tabId: source.tabId, expires: now + OFFER_LIFETIME_MS });
    const offer: PasswordOffer = {
      id,
      tabId: source.tabId,
      origin: source.origin,
      username,
      update: passwordStore.forOrigin(source.origin).some((login) => login.username === username),
    };
    send(IPC.PASSWORD_OFFER, offer);
  };

  ipcMain.on('password:form', onForm);
  ipcMain.on('password:submitted', onSubmitted);

  handle(IPC.PASSWORD_OFFER_REPLY, (_e, id: string, choice: 'save' | 'never' | 'dismiss') => {
    const offer = offers.get(id);
    offers.delete(id);
    if (!offer || offer.expires < Date.now()) return 'expired';
    if (choice === 'save') passwordStore.save(offer.origin, offer.username, offer.password);
    else if (choice === 'never') passwordStore.neverSaveFor(offer.origin);
    publishState(offer.tabId);
    return 'done';
  });

  const fill = (tabId: string, loginId: string): boolean => {
    const view = tabManager.getView(tabId);
    const origin = loginOrigin(view?.webContents.getURL() ?? '');
    // Checked against the page as it is now: a page that changed site gets nothing.
    const login = origin ? passwordStore.passwordFor(loginId, origin) : null;
    if (!view || !login) return false;
    view.webContents.send('password:fill', login);
    return true;
  };

  // One saved login fills at once; several open a native menu to choose
  // from (it draws above the page, which a page-area dropdown cannot).
  handle(IPC.PASSWORD_FILL, (_e, tabId: string, loginId?: string) => {
    const origin = loginOrigin(tabManager.getView(tabId)?.webContents.getURL() ?? '');
    const logins = origin ? passwordStore.forOrigin(origin) : [];
    const chosen = loginId ?? (logins.length === 1 ? logins[0]!.id : undefined);
    if (chosen) {
      if (!fill(tabId, chosen)) throw new Error('That saved password is not for this site.');
      return;
    }
    if (!logins.length) throw new Error('No password is saved for this site.');
    Menu.buildFromTemplate(logins.map((login) => ({
      label: login.username || '(no username)',
      click: () => { fill(tabId, login.id); },
    }))).popup({ window: win });
  });

  handle(IPC.PASSWORD_LIST, () => passwordStore.list());
  handle(IPC.PASSWORD_DELETE, (_e, id: string) => {
    passwordStore.remove(id);
    const active = tabManager.getActiveId();
    if (active) publishState(active);
  });
  handle(IPC.PASSWORD_IMPORT, async () => {
    const picked = await dialog.showOpenDialog(win, {
      title: 'Import passwords',
      message: 'Choose a password export from Apple Passwords, Chrome or Firefox (.csv).',
      properties: ['openFile'],
      filters: [{ name: 'Password export', extensions: ['csv'] }],
    });
    const file = picked.filePaths[0];
    if (picked.canceled || !file) return null;
    const result = passwordStore.importCsv(await readFile(file, 'utf8'));
    const active = tabManager.getActiveId();
    if (active) publishState(active);
    return result;
  });

  // A new page starts without a sign-in form until it reports one.
  const offNavigate = tabManager.onMainFrameNavigate((tabId) => {
    forms.set(tabId, false);
    publishState(tabId);
  });

  return () => {
    ipcMain.off('password:form', onForm);
    ipcMain.off('password:submitted', onSubmitted);
    offNavigate();
  };
}
