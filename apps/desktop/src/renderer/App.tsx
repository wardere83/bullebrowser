import { useEffect, useRef } from 'react';
import { spacing } from '@bullebrowser/brand-tokens';
import { TopBar } from './components/TopBar.js';
import { TabStrip } from './components/TabStrip.js';
import { AiPanel } from './components/AiPanel.js';
import { SettingsModal } from './components/SettingsModal.js';
import { ConfirmDialog } from './components/ConfirmDialog.js';
import { AboutModal } from './components/AboutModal.js';
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

  // The start page shows when there's nothing to browse yet: no tabs at all,
  // or the active tab is still sitting on the start page. Must agree with
  // isStartPage() in the tab manager, which hides the page view to match.
  const activeTab = tabs.find((t) => t.active);
  const showStartPage =
    tabs.length === 0 || !activeTab?.url || activeTab.url === 'about:blank';

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
      // Only a run-level error (no toolName) ends the run. A tool error — a
      // click that matched nothing, a declined confirmation — is reported back
      // to the model, which carries on and usually recovers; treating it as
      // fatal hid the Stop button while the agent was still driving the page.
      const runFailed = step.kind === 'error' && !step.toolName;
      if (step.kind === 'done') finishRun();
      if (runFailed) setError(step.message);
      // When a run finishes, the main process has saved the assistant's
      // reply to the conversation store. Refetch so the response appears
      // in the AI panel — without this, only the user's optimistic message
      // shows and the assistant's text never makes it into the visible
      // conversation history.
      if (step.kind === 'done' || runFailed) {
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

  // Consent requests from a run. Browsing access is answered inline in the
  // chat (AiPanel); destructive actions get the modal. Both go through
  // pendingConfirm — nothing is auto-approved on the user's behalf.
  useEffect(() => {
    return window.bullebrowser.agent.onConfirmRequest((req) =>
      setPendingConfirm(req),
    );
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
        {/* The active WebContentsView is laid out by main and covers this
            area — except on the start page, where main hides the view so the
            branded start page below shows through. */}
        <div className="flex-1 bg-surface-light">
          {showStartPage && <Splash />}
        </div>
        {aiPanelOpen && <AiPanel />}
      </div>
      <ConfirmDialog />
      {showSettings && <SettingsModal />}
      {showAbout && <AboutModal />}
    </div>
  );
}
