import { useEffect, useRef, useState } from 'react';
import { useBrowserStore, activeTabSelector } from '../state/browser-store.js';
import { useAgentStore } from '../state/agent-store.js';
import { AGENT_PROMPT_EVENT, parseAddressBarInput } from '../lib/url.js';
import { useInputActivity } from '../hooks/useInputActivity.js';
import { FOCUS_AI_PANEL_EVENT } from './AiPanel.js';
import brandIcon from '../assets/bullebrowser-icon.png';
import { UpdateBanner } from './UpdateBanner.js';

const IS_MAC = navigator.userAgent.includes('Macintosh');
// Three 12px buttons from x=16 (window.ts trafficLightPosition) plus a gap.
const MAC_TRAFFIC_LIGHT_GUTTER = 84;

export function TopBar() {
  const fullScreen = useFullScreen();
  const active = useBrowserStore(activeTabSelector);
  const aiPanelOpen = useBrowserStore((s) => s.aiPanelOpen);
  const setAiPanelOpen = useBrowserStore((s) => s.setAiPanelOpen);
  const openSettings = useBrowserStore((s) => s.openSettings);
  const openAccessibility = useBrowserStore((s) => s.openAccessibility);
  const showAccessibility = useBrowserStore((s) => s.showAccessibility);
  const openAbout = useBrowserStore((s) => s.openAbout);
  const currentStep = useAgentStore((s) => s.currentStep);
  const status = useAgentStore((s) => s.status);
  const runId = useAgentStore((s) => s.runId);
  const searchProvider = useBrowserStore((s) => s.searchProvider);
  const [navigationError, setNavigationError] = useState('');
  const [draftUrl, setDraftUrl] = useState('');
  const [profileOpen, setProfileOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const addressActivity = useInputActivity();

  useEffect(() => {
    setDraftUrl(active?.url === 'about:blank' ? '' : (active?.url ?? ''));
  }, [active?.id, active?.url]);

  useEffect(() => {
    const handler = () => inputRef.current?.select();
    window.addEventListener('bullebrowser:focus-address', handler);
    return () => window.removeEventListener('bullebrowser:focus-address', handler);
  }, []);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setNavigationError('');
    if (!active || !draftUrl.trim()) return;
    const action = parseAddressBarInput(draftUrl, searchProvider);
    if (action.type === 'agent') {
      // BulleBrowser address bar → AI agent. Open the panel and hand
      // the prompt off via a custom event so AiPanel can send it.
      setAiPanelOpen(true);
      window.dispatchEvent(
        new CustomEvent<string>(AGENT_PROMPT_EVENT, { detail: action.prompt }),
      );
      setDraftUrl(active.url === 'about:blank' ? '' : active.url);
      return;
    }
    void window.bullebrowser.tabs.navigate(active.id, action.url).catch(() => {
      setNavigationError('This destination could not be opened. It may be blocked by BulleBrowser policy.');
    });
  };

  const openAssistant = () => {
    setAiPanelOpen(true);
    setTimeout(() => window.dispatchEvent(new Event(FOCUS_AI_PANEL_EVENT)), 0);
    setTimeout(() => window.dispatchEvent(new Event(FOCUS_AI_PANEL_EVENT)), 80);
  };

  return (
    <header
      className="drag-region flex h-11 items-center gap-2 border-b border-line bg-white px-3 text-ink-primary"
      // macOS draws the window buttons inside this bar (hiddenInset); keep
      // them clear of the logo and the back / forward buttons, except in full
      // screen, where macOS hides them.
      style={IS_MAC && !fullScreen ? { paddingLeft: MAC_TRAFFIC_LIGHT_GUTTER } : undefined}
    >
      <img src={brandIcon} alt="" width={20} height={20} className="no-drag shrink-0" />
      <div className="no-drag flex items-center gap-1">
        <NavBtn
          label="Back"
          disabled={!active?.canGoBack}
          onClick={() => active && window.bullebrowser.tabs.back(active.id)}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </NavBtn>
        <NavBtn
          label="Forward"
          disabled={!active?.canGoForward}
          onClick={() => active && window.bullebrowser.tabs.forward(active.id)}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M9 6l6 6-6 6" />
          </svg>
        </NavBtn>
        <NavBtn
          label="Reload"
          onClick={() => active && window.bullebrowser.tabs.reload(active.id)}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 12a9 9 0 1 1-3-6.7" />
            <path d="M21 4v5h-5" />
          </svg>
        </NavBtn>
      </div>

      <form onSubmit={submit} className="no-drag min-w-0 flex-1">
        <div
          className={`h-7 prompt-input-shell prompt-input-shell--${addressActivity.state}`}
          data-activity-state={addressActivity.state}
        >
          <input
            ref={inputRef}
            type="text"
            value={draftUrl}
            onChange={(e) => {
              setDraftUrl(e.target.value);
              addressActivity.onInputActivity();
            }}
            onPaste={() => addressActivity.onInputActivity()}
            onFocus={addressActivity.onFocus}
            onBlur={addressActivity.onBlur}
            placeholder="Ask BulleBrowser or enter address"
            aria-label="Address bar"
            className="prompt-input-field prompt-input-field--singleline"
          />
        </div>
      </form>

      {status === 'running' && (
        <div className="no-drag flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1 text-xs text-ink-primary">
          <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-primary" />
          <span className="max-w-[280px] truncate">{currentStep || 'Agent is working…'}</span>
          <button
            type="button"
            className="rounded bg-surface-muted px-2 py-0.5 text-[11px] hover:bg-line"
            onClick={() => runId && window.bullebrowser.agent.cancel(runId)}
          >
            Stop
          </button>
        </div>
      )}

      <button
        type="button"
        onClick={openAssistant}
        className={`no-drag rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
          aiPanelOpen
            ? 'bg-primary text-ink-primary'
            : 'bg-surface-muted text-ink-primary hover:bg-line'
        }`}
        aria-pressed={aiPanelOpen}
      >
        Your Assistant
      </button>

      <button
        type="button" onClick={openAccessibility} aria-label="Accessibility"
        title="Accessibility" aria-haspopup="dialog" aria-expanded={showAccessibility}
        className="no-drag grid h-8 w-8 shrink-0 place-items-center rounded-full border border-line bg-white text-ink-primary hover:bg-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="15" cy="4" r="2" />
          <path d="m14 7-1 6h6l3 6h-4l-2-4h-5l1-8M10 10a6 6 0 1 0 6 8" />
        </svg>
      </button>
      <div className="no-drag relative">
        <button
          type="button"
          onClick={() => setProfileOpen((v) => !v)}
          className="grid h-7 w-7 place-items-center rounded-full bg-surface-muted text-xs font-semibold text-ink-primary hover:bg-line"
          aria-label="Profile menu"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" />
          </svg>
        </button>
        {profileOpen && (
          <div className="absolute right-0 top-9 z-50 w-48 overflow-hidden rounded-md border border-line bg-surface-light text-ink-primary shadow-lg">
            <MenuItem
              onClick={() => {
                openSettings();
                setProfileOpen(false);
              }}
            >
              Settings
            </MenuItem>
            <MenuItem
              onClick={() => {
                openAbout();
                setProfileOpen(false);
              }}
            >
              About BulleBrowser
            </MenuItem>
            <MenuItem
              onClick={() => {
                setProfileOpen(false);
                void window.bullebrowser.app.quit();
              }}
            >
              Quit
            </MenuItem>
          </div>
        )}
      </div>

      {/* Published updates stay visible through download and preparation. */}
      <UpdateBanner />
      {navigationError && <span role="alert" className="no-drag max-w-64 text-xs text-danger">{navigationError}</span>}
    </header>
  );
}

function NavBtn({
  children,
  label,
  disabled,
  onClick,
}: {
  children: React.ReactNode;
  label: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="grid h-7 w-7 place-items-center rounded-md text-ink-primary transition-colors hover:bg-surface-muted disabled:opacity-30 disabled:hover:bg-transparent"
    >
      {children}
    </button>
  );
}

function MenuItem({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="block w-full px-3 py-2 text-left text-sm hover:bg-surface-muted"
    >
      {children}
    </button>
  );
}

// Full screen hides the macOS window buttons, so the gutter can go too. The
// window is full-screen exactly when it fills the whole display.
function useFullScreen(): boolean {
  const check = () => window.innerWidth === screen.width && window.innerHeight === screen.height;
  const [full, setFull] = useState(check);
  useEffect(() => {
    const onResize = () => setFull(check());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return full;
}
