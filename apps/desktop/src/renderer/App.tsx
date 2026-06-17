import { useEffect, useRef } from 'react';
import { spacing } from '@bullebrowser/brand-tokens';
import { TopBar } from './components/TopBar.js';
import { TabStrip } from './components/TabStrip.js';
import { AiPanel } from './components/AiPanel.js';
import { SettingsModal } from './components/SettingsModal.js';
import { AboutModal } from './components/AboutModal.js';
import { ConfirmDialog } from './components/ConfirmDialog.js';
import { Splash } from './components/Splash.js';
import { useBrowserStore } from './state/browser-store.js';
import { useAgentStore } from './state/agent-store.js';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts.js';
import { AGENT_PROMPT_EVENT } from './lib/url.js';

export function App() {
  const tabs = useBrowserStore((s) => s.tabs);
  const aiPanelOpen = useBrowserStore((s) => s.aiPanelOpen);
  const setTabs = useBrowserStore((s) => s.setTabs);
  const setAiPanelOpen = useBrowserStore((s) => s.setAiPanelOpen);
  const setSearchProvider = useBrowserStore((s) => s.setSearchProvider);
  const showSettings = useBrowserStore((s) => s.showSettings);
  const showAbout = useBrowserStore((s) => s.showAbout);
  const appendStep = useAgentStore((s) => s.appendStep);
  const finishRun = useAgentStore((s) => s.finishRun);
  const setError = useAgentStore((s) => s.setError);
  const setPendingConfirm = useAgentStore((s) => s.setPendingConfirm);
  const initialized = useRef(false);

  useKeyboardShortcuts();

  // Initial sync with main + first tab if none.
  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    (async () => {
      const settings = await window.bullebrowser.settings.get();
      setAiPanelOpen(settings.aiPanelOpen);
      setSearchProvider(settings.searchProvider);
      const list = await window.bullebrowser.tabs.list();
      if (list.length === 0) {
        await window.bullebrowser.tabs.create();
      } else {
        setTabs(list);
      }
    })();
  }, [setAiPanelOpen, setTabs, setSearchProvider]);

  // Subscribe to tab updates.
  useEffect(() => {
    return window.bullebrowser.tabs.onUpdated((next) => setTabs(next));
  }, [setTabs]);

  // Subscribe to agent steps.
  useEffect(() => {
    return window.bullebrowser.agent.onStep(({ step }) => {
      appendStep(step);
      if (step.kind === 'done') finishRun();
      if (step.kind === 'error') setError(step.message);
      // When a run finishes, the main process has saved the assistant's
      // reply to the conversation store. Refetch so the response appears
      // in the AI panel — without this, only the user's optimistic message
      // shows and the assistant's text never makes it into the visible
      // conversation history.
      if (step.kind === 'done' || step.kind === 'error') {
        const cur = useAgentStore.getState().current;
        if (cur?.id) {
          void window.bullebrowser.conversations.get(cur.id).then((updated) => {
            // refreshCurrent updates messages without resetting steps/
            // status — so the visible error/feed survives the refresh.
            if (updated) useAgentStore.getState().refreshCurrent(updated);
          });
        }
      }
    });
  }, [appendStep, finishRun, setError]);

  // Subscribe to destructive confirm requests.
  useEffect(() => {
    return window.bullebrowser.agent.onConfirmRequest(({ runId, id, message }) => {
      setPendingConfirm({ id, runId, message });
    });
  }, [setPendingConfirm]);

  // Right-click → "Ask BulleBrowser" comes in over IPC. Open the AI
  // panel (so AiPanel mounts) and re-emit the prompt as the in-window
  // AGENT_PROMPT_EVENT — AiPanel already handles that channel with a
  // queued-prompt fallback for the first-render race.
  useEffect(() => {
    return window.bullebrowser.ui.onAskAgent((prompt) => {
      setAiPanelOpen(true);
      window.dispatchEvent(
        new CustomEvent<string>(AGENT_PROMPT_EVENT, { detail: prompt }),
      );
    });
  }, [setAiPanelOpen]);

  // Push layout bounds to main so the WebContentsView fits.
  useEffect(() => {
    const top = spacing.topBarHeight + spacing.tabStripHeight;
    const right = aiPanelOpen ? spacing.aiPanelWidth : 0;
    void window.bullebrowser.layout.setBounds({ topInset: top, rightInset: right });
    void window.bullebrowser.settings.set({ aiPanelOpen });
  }, [aiPanelOpen]);

  return (
    <div className="flex h-screen flex-col bg-surface-dark">
      <TopBar />
      <TabStrip />
      <div className="flex flex-1 overflow-hidden">
        {/* The active WebContentsView is laid out by main; this placeholder
            reserves the area visually. */}
        <div className="flex-1 bg-surface-light">
          {tabs.length === 0 && <Splash />}
        </div>
        {aiPanelOpen && <AiPanel />}
      </div>
      {showSettings && <SettingsModal />}
      {showAbout && <AboutModal />}
      <ConfirmDialog />
    </div>
  );
}
