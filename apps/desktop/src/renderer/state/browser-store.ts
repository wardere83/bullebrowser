// Renderer-side state. The main process is the source of truth for
// tabs/history/etc; we mirror it here for fast UI rendering and update
// on TAB_UPDATED broadcasts.

import { create } from 'zustand';
import type { AppSettings, TabState } from '../../shared/ipc.js';

interface BrowserStoreState {
  tabs: TabState[];
  aiPanelOpen: boolean;
  searchProvider: AppSettings['searchProvider'];
  showSettings: boolean;
  showAbout: boolean;
  showUpdates: boolean;
  showAccessibility: boolean;
  /** The top bar's menu (Settings, About, Quit); it hangs over the page. */
  profileMenuOpen: boolean;
  setProfileMenuOpen: (open: boolean) => void;
  openAccessibility: () => void;
  closeAccessibility: () => void;
  workspaceTabId: string | null;
  setWorkspaceTab: (tabId: string | null) => void;
  setTabs: (tabs: TabState[]) => void;
  toggleAiPanel: () => void;
  setAiPanelOpen: (open: boolean) => void;
  setSearchProvider: (searchProvider: AppSettings['searchProvider']) => void;
  openSettings: () => void;
  closeSettings: () => void;
  openUpdates: () => void;
  closeUpdates: () => void;
  openAbout: () => void;
  closeAbout: () => void;
}

export const useBrowserStore = create<BrowserStoreState>((set) => ({
  tabs: [],
  aiPanelOpen: false,
  searchProvider: 'bullebrowser',
  showSettings: false,
  showAbout: false,
  showUpdates: false,
  openUpdates: () => set({ showUpdates: true }),
  closeUpdates: () => set({ showUpdates: false }),
  showAccessibility: false,
  profileMenuOpen: false,
  setProfileMenuOpen: (profileMenuOpen) => set({ profileMenuOpen }),
  openAccessibility: () => set({ showAccessibility: true }),
  closeAccessibility: () => set({ showAccessibility: false }),
  workspaceTabId: null,
  setWorkspaceTab: (workspaceTabId) => set({ workspaceTabId }),
  setTabs: (tabs) =>
    set((state) => ({
      tabs,
      workspaceTabId: tabs.some(
        (tab) => tab.id === state.workspaceTabId && (!tab.url || tab.url === 'about:blank'),
      )
        ? state.workspaceTabId
        : null,
    })),
  toggleAiPanel: () => set((s) => ({ aiPanelOpen: !s.aiPanelOpen })),
  setAiPanelOpen: (open) => set({ aiPanelOpen: open }),
  setSearchProvider: (searchProvider) => set({ searchProvider }),
  openSettings: () => set({ showSettings: true }),
  closeSettings: () => set({ showSettings: false }),
  openAbout: () => set({ showAbout: true }),
  closeAbout: () => set({ showAbout: false }),
}));

export const activeTabSelector = (s: BrowserStoreState): TabState | undefined =>
  s.tabs.find((t) => t.active);

/**
 * Whether renderer chrome is drawn over the page area. The page is a native
 * view stacked above the renderer, so main hides it while this is true;
 * otherwise the page covers the chrome (the top bar menu's About and Quit sat
 * under it).
 */
export const chromeCoversPageSelector = (s: BrowserStoreState): boolean =>
  s.showUpdates || s.showSettings || s.showAbout || s.showAccessibility || s.profileMenuOpen;
