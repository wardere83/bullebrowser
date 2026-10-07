import { useEffect, useRef } from 'react';
import { spacing } from '@bullebrowser/brand-tokens';
import { TopBar } from './components/TopBar.js';
import { TabStrip } from './components/TabStrip.js';
import { AiPanel } from './components/AiPanel.js';
import { SettingsModal } from './components/SettingsModal.js';
import { ConfirmDialog } from './components/ConfirmDialog.js';
import { AboutModal } from './components/AboutModal.js';
import { Splash } from './components/Splash.js';
import { Workspace } from './workspace/Workspace.js';
import { useBrowserStore } from './state/browser-store.js';
import { useAgentStore } from './state/agent-store.js';
import { isStartPageUrl, useWorkspaceConnection } from './state/workspace-store.js';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts.js';
import { AGENT_PROMPT_EVENT } from './lib/url.js';
import { refreshVoiceConversation } from './lib/voice-agent.js';

export function App() {
  const tabs = useBrowserStore((s) => s.tabs);
  const aiPanelOpen = useBrowserStore((s) => s.aiPanelOpen);
  const setTabs = useBrowserStore((s) => s.setTabs);
  const setAiPanelOpen = useBrowserStore((s) => s.setAiPanelOpen);
  const setSearchProvider = useBrowserStore((s) => s.setSearchProvider);
  const showSettings = useBrowserStore((s) => s.showSettings);
  const showAbout = useBrowserStore((s) => s.showAbout);
  const workspaceTabId = useBrowserStore((s) => s.workspaceTabId);
  const setWorkspaceTab = useBrowserStore((s) => s.setWorkspaceTab);
  const appendStep = useAgentStore((s) => s.appendStep);
  const finishRun = useAgentStore((s) => s.finishRun);
  const setError = useAgentStore((s) => s.setError);
  const setPendingConfirm = useAgentStore((s) => s.setPendingConfirm);
  const initialized = useRef(false);

  useKeyboardShortcuts();
  // Identity, setup status and funding events for the workspace and for the
  // assistant panel's grounding line, which shows on every tab.
  useWorkspaceConnection();

  // Only an explicitly opened funding tab shows tools in the page slot.
  // Main hides the native page view on about:blank to let those tools show.
  const activeTab = tabs.find((t) => t.active);
  const showWorkspace = Boolean(
    activeTab && activeTab.id === workspaceTabId && isStartPageUrl(activeTab.url),
  );
  const showIntro = !showWorkspace && (!activeTab || isStartPageUrl(activeTab.url));

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
    return window.bullebrowser.agent.onStep(({ runId, step }) => {
      const activeRunId = useAgentStore.getState().runId;
      if (activeRunId && activeRunId !== runId) return;
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
        if (useAgentStore.getState().pendingConfirm?.runId === runId) {
          setPendingConfirm(null);
        }
        const cur = useAgentStore.getState().current;
        if (cur?.id) {
          void refreshVoiceConversation(window.bullebrowser, cur.id, {
            current: () => useAgentStore.getState().current,
            // Retain progress and errors, and preserve a newer prompt or chat
            // selected while this saved answer is being read.
            refresh: (updated) => useAgentStore.getState().refreshCurrent(updated),
          });
        }
      }
    });
  }, [appendStep, finishRun, setError, setPendingConfirm]);

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
        {/* Blank tabs show the video intro. Funding tools open only on request;
            navigating to a web page gives the slot to its native page view. */}
        <div className="flex min-w-0 flex-1 flex-col bg-surface-light">
          {showWorkspace && (
            <div className="flex shrink-0 justify-end bg-surface-dark px-4 py-2">
              <button
                type="button"
                onClick={() => setWorkspaceTab(null)}
                className="rounded px-2 py-1 text-xs text-ink-inverse hover:bg-white/10"
              >
                Back to browsing
              </button>
            </div>
          )}
          <div className="min-h-0 flex-1">
            {showIntro && <Splash />}
            <Workspace visible={showWorkspace} />
          </div>
        </div>
        {aiPanelOpen && <AiPanel />}
      </div>
      <ConfirmDialog />
      {showSettings && <SettingsModal />}
      {showAbout && <AboutModal />}
    </div>
  );
}
