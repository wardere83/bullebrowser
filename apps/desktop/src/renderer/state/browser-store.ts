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
  workspaceTabId: string | null;
  setWorkspaceTab: (tabId: string | null) => void;
  setTabs: (tabs: TabState[]) => void;
  toggleAiPanel: () => void;
  setAiPanelOpen: (open: boolean) => void;
  setSearchProvider: (searchProvider: AppSettings['searchProvider']) => void;
  openSettings: () => void;
  closeSettings: () => void;
  openAbout: () => void;
  closeAbout: () => void;
}

export const useBrowserStore = create<BrowserStoreState>((set) => ({
  tabs: [],
  aiPanelOpen: false,
  searchProvider: 'bullebrowser',
  showSettings: false,
  showAbout: false,
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
