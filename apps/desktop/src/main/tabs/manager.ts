// Tab manager. Owns one WebContentsView per tab, attaches them to the
// main BaseWindow, and broadcasts state changes to the renderer.

import { type BrowserWindow, Menu, MenuItem, WebContentsView, clipboard } from 'electron';
import { randomUUID } from 'node:crypto';
import { IPC, type TabState, type LayoutBounds } from '../../shared/ipc.js';
import { historyStore } from '../storage/history.js';
import { getSettings } from '../storage/settings.js';

function getDefaultHome(): string {
  return getSettings().homepageUrl;
}

interface ManagedTab {
  id: string;
  view: WebContentsView;
  title: string;
  url: string;
  loading: boolean;
  faviconUrl?: string;
}

class TabManager {
  private win: BrowserWindow | null = null;
  private tabs: ManagedTab[] = [];
  private activeId: string | null = null;
  private bounds: LayoutBounds = { topInset: 80, rightInset: 0 };

  attachWindow(win: BrowserWindow) {
    this.win = win;
    win.on('resize', () => this.relayout());
    win.on('closed', () => {
      this.tabs = [];
      this.win = null;
    });
  }

  setBounds(bounds: LayoutBounds) {
    this.bounds = bounds;
    this.relayout();
  }

  list(): TabState[] {
    return this.tabs.map((t) => this.toState(t));
  }

  async create(url?: string): Promise<TabState> {
    if (!this.win) throw new Error('No window attached');
    const id = randomUUID();
    const view = new WebContentsView({
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    const tab: ManagedTab = {
      id,
      view,
      title: 'New Tab',
      url: url ?? getDefaultHome(),
      loading: true,
    };
    this.tabs.push(tab);
    this.win.contentView.addChildView(view);
    this.wireEvents(tab);
    this.activate(id);
    // Kick off the load but don't let a failed navigation (offline, bad
    // cert, dead link) reject tab creation — the WebContents renders its
    // own error page and did-fail-load clears the loading state.
    void view.webContents.loadURL(tab.url).catch(() => {});
    this.broadcast();
    return this.toState(tab);
  }

  async close(id: string): Promise<void> {
    const idx = this.tabs.findIndex((t) => t.id === id);
    if (idx < 0) return;
    const [tab] = this.tabs.splice(idx, 1);
    if (!tab) return;
    this.win?.contentView.removeChildView(tab.view);
    tab.view.webContents.close();
    if (this.activeId === id) {
      const next = this.tabs[Math.min(idx, this.tabs.length - 1)];
      this.activeId = next?.id ?? null;
      this.relayout();
    }
    this.broadcast();
  }

  activate(id: string): void {
    if (!this.tabs.find((t) => t.id === id)) return;
    this.activeId = id;
    this.relayout();
    this.broadcast();
  }

  reorder(orderedIds: string[]): void {
    const map = new Map(this.tabs.map((t) => [t.id, t]));
    const next: ManagedTab[] = [];
    for (const id of orderedIds) {
      const t = map.get(id);
      if (t) next.push(t);
    }
    if (next.length === this.tabs.length) {
      this.tabs = next;
      this.broadcast();
    }
  }

  async navigate(id: string, url: string): Promise<void> {
    const tab = this.find(id);
    if (!tab) return;
    // Failed navigations show an error page in the view; don't reject.
    await tab.view.webContents.loadURL(url).catch(() => {});
  }

  async reload(id: string): Promise<void> {
    this.find(id)?.view.webContents.reload();
  }

  async back(id: string): Promise<void> {
    const wc = this.find(id)?.view.webContents;
    if (wc?.navigationHistory.canGoBack()) wc.navigationHistory.goBack();
  }

  async forward(id: string): Promise<void> {
    const wc = this.find(id)?.view.webContents;
    if (wc?.navigationHistory.canGoForward()) wc.navigationHistory.goForward();
  }

  getActiveId(): string | null {
    return this.activeId;
  }

  getView(id: string): WebContentsView | undefined {
    return this.find(id)?.view;
  }

  // --- internal ---

  private find(id: string): ManagedTab | undefined {
    return this.tabs.find((t) => t.id === id);
  }

  private toState(t: ManagedTab): TabState {
    const wc = t.view.webContents;
    return {
      id: t.id,
      title: t.title || 'Untitled',
      url: t.url,
      loading: t.loading,
      canGoBack: wc.navigationHistory.canGoBack(),
      canGoForward: wc.navigationHistory.canGoForward(),
      faviconUrl: t.faviconUrl,
      active: this.activeId === t.id,
    };
  }

  private wireEvents(tab: ManagedTab) {
    const wc = tab.view.webContents;
    wc.on('did-start-loading', () => {
      tab.loading = true;
      this.broadcast();
    });
    wc.on('did-stop-loading', () => {
      tab.loading = false;
      this.broadcast();
    });
    // ERR_ABORTED (-3) is normal (redirects, user navigation); ignore it.
    // Real failures clear the spinner so the chrome doesn't hang on "Loading…".
    wc.on('did-fail-load', (_e, errorCode, _desc, _url, isMainFrame) => {
      if (isMainFrame && errorCode !== -3) {
        tab.loading = false;
        this.broadcast();
      }
    });
    wc.on('page-title-updated', (_e, title) => {
      tab.title = title;
      this.broadcast();
    });
    wc.on('page-favicon-updated', (_e, favicons) => {
      tab.faviconUrl = favicons[0];
      this.broadcast();
    });
    wc.on('did-navigate', (_e, url) => {
      tab.url = url;
      this.broadcast();
      historyStore.record({ url, title: tab.title, visitedAt: Date.now() });
    });
    wc.on('did-navigate-in-page', (_e, url) => {
      tab.url = url;
      this.broadcast();
    });
    wc.setWindowOpenHandler(({ url }) => {
      void this.create(url);
      return { action: 'deny' };
    });

    // Right-click context menu. We build it dynamically so the items track
    // what the user actually clicked: a text selection, a link, or just
    // the page background. The "Ask BulleBrowser" items are the agentic-
    // browser hook — they send a prompt to the renderer which opens the
    // AI panel and fires the run.
    wc.on('context-menu', (_e, params) => {
      const menu = new Menu();
      const selection = (params.selectionText || '').trim();
      const linkURL = params.linkURL;

      if (selection) {
        menu.append(
          new MenuItem({
            label: `Ask BulleBrowser about "${truncate(selection, 40)}"`,
            click: () => this.askAgent(`${selection}\n\nExplain or answer based on this selection.`),
          }),
        );
        menu.append(
          new MenuItem({
            label: 'Copy',
            role: 'copy',
          }),
        );
        menu.append(
          new MenuItem({
            label: 'Search the web',
            click: () =>
              void this.create(
                `https://www.google.com/search?q=${encodeURIComponent(selection)}`,
              ),
          }),
        );
        menu.append(new MenuItem({ type: 'separator' }));
      }

      if (linkURL) {
        menu.append(
          new MenuItem({
            label: 'Open link in new tab',
            click: () => void this.create(linkURL),
          }),
        );
        menu.append(
          new MenuItem({
            label: 'Copy link',
            click: () => clipboard.writeText(linkURL),
          }),
        );
        menu.append(
          new MenuItem({
            label: 'Ask BulleBrowser about this link',
            click: () =>
              this.askAgent(
                `Open ${linkURL} in a new tab, then summarize what it says and tell me whether it answers what I'm looking at now.`,
              ),
          }),
        );
        menu.append(new MenuItem({ type: 'separator' }));
      }

      menu.append(
        new MenuItem({
          label: 'Summarize this page with BulleBrowser',
          click: () =>
            this.askAgent(
              'Read the current tab and give me a concise summary with the key points, named entities, and any action items.',
            ),
        }),
      );

      if (params.isEditable) {
        menu.append(new MenuItem({ type: 'separator' }));
        menu.append(new MenuItem({ label: 'Cut', role: 'cut' }));
        menu.append(new MenuItem({ label: 'Paste', role: 'paste' }));
      }

      menu.append(new MenuItem({ type: 'separator' }));
      menu.append(
        new MenuItem({
          label: 'Back',
          enabled: wc.navigationHistory.canGoBack(),
          click: () => wc.navigationHistory.goBack(),
        }),
      );
      menu.append(
        new MenuItem({
          label: 'Forward',
          enabled: wc.navigationHistory.canGoForward(),
          click: () => wc.navigationHistory.goForward(),
        }),
      );
      menu.append(new MenuItem({ label: 'Reload', click: () => wc.reload() }));

      if (this.win) menu.popup({ window: this.win });
    });
  }

  private askAgent(prompt: string) {
    if (!this.win) return;
    this.win.webContents.send(IPC.UI_ASK_AGENT, prompt);
  }

  private relayout() {
    if (!this.win) return;
    const [w, h] = this.win.getContentSize();
    const top = this.bounds.topInset;
    const right = this.bounds.rightInset;
    for (const t of this.tabs) {
      if (t.id === this.activeId) {
        t.view.setBounds({
          x: 0,
          y: top,
          width: Math.max(0, w - right),
          height: Math.max(0, h - top),
        });
        t.view.setVisible(true);
      } else {
        t.view.setBounds({ x: 0, y: top, width: 0, height: 0 });
        t.view.setVisible(false);
      }
    }
  }

  private broadcast() {
    if (!this.win) return;
    this.win.webContents.send(IPC.TAB_UPDATED, this.list());
  }
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

export const tabManager = new TabManager();
