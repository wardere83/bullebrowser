import { useEffect } from 'react';
import { useBrowserStore } from '../state/browser-store.js';
import { FOCUS_AI_PANEL_EVENT } from '../components/AiPanel.js';

export function useKeyboardShortcuts() {
  const toggleAi = useBrowserStore((s) => s.toggleAiPanel);
  const setAiPanelOpen = useBrowserStore((s) => s.setAiPanelOpen);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      // New tab, close tab and reload are menu accelerators (main/menu.ts),
      // so they work while a web page has focus too; handling them here as
      // well would fire them twice.
      if (e.key.toLowerCase() === 'l') {
        e.preventDefault();
        window.dispatchEvent(new Event('bullebrowser:focus-address'));
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
