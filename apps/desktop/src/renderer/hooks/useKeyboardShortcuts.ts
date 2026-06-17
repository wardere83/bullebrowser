import { useEffect } from 'react';
import { useBrowserStore, activeTabSelector } from '../state/browser-store.js';
import { FOCUS_AI_PANEL_EVENT } from '../components/AiPanel.js';

export function useKeyboardShortcuts() {
  const toggleAi = useBrowserStore((s) => s.toggleAiPanel);
  const setAiPanelOpen = useBrowserStore((s) => s.setAiPanelOpen);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      const active = activeTabSelector(useBrowserStore.getState());
      if (e.key.toLowerCase() === 't') {
        e.preventDefault();
        void window.bullebrowser.tabs.create();
      } else if (e.key.toLowerCase() === 'w') {
        e.preventDefault();
        if (active) void window.bullebrowser.tabs.close(active.id);
      } else if (e.key.toLowerCase() === 'l') {
        e.preventDefault();
        window.dispatchEvent(new Event('bullebrowser:focus-address'));
      } else if (e.key.toLowerCase() === 'r') {
        e.preventDefault();
        if (active) void window.bullebrowser.tabs.reload(active.id);
      } else if (e.shiftKey && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        toggleAi();
      } else if (e.key === '/') {
        // Cmd+/  — summon the agent: open the panel and focus its input,
        // Comet-style.
        e.preventDefault();
        setAiPanelOpen(true);
        // Defer one tick so the panel mounts and the textarea ref is live.
        setTimeout(() => window.dispatchEvent(new Event(FOCUS_AI_PANEL_EVENT)), 0);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggleAi, setAiPanelOpen]);
}
