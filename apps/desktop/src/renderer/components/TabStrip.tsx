import { useEffect, useRef, useState } from 'react';
import { useBrowserStore } from '../state/browser-store.js';
import type { TabState } from '../../shared/ipc.js';

export function TabStrip() {
  const tabs = useBrowserStore((s) => s.tabs);
  const [dragId, setDragId] = useState<string | null>(null);


  const onDragStart = (id: string) => setDragId(id);
  const onDragOver = (e: React.DragEvent, overId: string) => {
    e.preventDefault();
    if (!dragId || dragId === overId) return;
    const order = tabs.map((t) => t.id);
    const from = order.indexOf(dragId);
    const to = order.indexOf(overId);
    if (from < 0 || to < 0) return;
    order.splice(to, 0, ...order.splice(from, 1));
    void window.bullebrowser.tabs.reorder(order);
  };
  const onDragEnd = () => setDragId(null);

  return (
    <div
      role="region"
      aria-label="Browser tabs"
      className="flex h-9 items-end gap-0.5 border-b border-line bg-white px-2 pt-1 text-ink-primary"
    >
      <div className="flex min-w-0 flex-1 items-end gap-0.5 overflow-x-auto">
        {tabs.map((t) => (
          <BrowserTab
            key={t.id}
            tab={t}
            onDragStart={() => onDragStart(t.id)}
            onDragOver={(e) => onDragOver(e, t.id)}
            onDragEnd={onDragEnd}
          />
        ))}
      </div>
      <button
        type="button"
        aria-label="New tab"
        onClick={() => window.bullebrowser.tabs.create()}
        className="ml-1 grid h-7 w-7 shrink-0 place-items-center rounded-md hover:bg-surface-muted"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M12 5v14M5 12h14" />
        </svg>
      </button>
    </div>
  );
}

export function BrowserTab({
  tab,
  onDragStart,
  onDragOver,
  onDragEnd,
}: {
  tab: TabState;
  onDragStart: () => void;
  onDragOver: (e: React.DragEvent) => void;
  onDragEnd: () => void;
}) {
  const tabRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = tabRef.current;
    if (!tab.active || !element?.parentElement) return;
    const reveal = () => element.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    reveal();
    const observer = new ResizeObserver(reveal);
    observer.observe(element.parentElement);
    return () => observer.disconnect();
  }, [tab.active]);
  const close = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (e.detail === 0 && document.activeElement === e.currentTarget) {
      const element = tabRef.current;
      const adjacent = element?.nextElementSibling ?? element?.previousElementSibling;
      const next = adjacent?.querySelector<HTMLButtonElement>('button[title="Close tab"]')
        ?? element?.parentElement?.parentElement?.querySelector<HTMLButtonElement>('button[aria-label="New tab"]');
      next?.focus();
    }
    void window.bullebrowser.tabs.close(tab.id);
  };
  return (
    <div
      ref={tabRef}
      role="group"
      aria-label="Browser tab"
      draggable
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      // Middle-click closes, as in every other browser.
      onAuxClick={(e) => {
        if (e.button === 1) close(e);
      }}
      title={tab.title || tab.url}
      className={`relative flex h-7 w-[180px] shrink-0 items-center rounded-t-md text-left text-xs transition-colors ${
        tab.active
          ? 'z-10 bg-surface-light font-medium text-ink-primary shadow-[inset_0_-3px_0_0_#20BAD1,0_0_10px_rgba(32,186,209,0.45)]'
          : 'bg-surface-muted text-ink-secondary hover:bg-surface-muted'
      }`}
    >
      <button type="button" aria-label={`Switch to ${tab.title || 'New Tab'}`} aria-pressed={tab.active}
        onClick={() => window.bullebrowser.tabs.switch(tab.id)}
        className="flex h-full min-w-0 flex-1 items-center gap-2 overflow-hidden pl-2 pr-1 text-left">
      {tab.faviconUrl ? (
        <img src={tab.faviconUrl} alt="" width={14} height={14} className="rounded-sm" />
      ) : (
        <div className="h-3.5 w-3.5 rounded-sm bg-current opacity-30" />
      )}
      <span className="flex-1 truncate">
        {tab.loading ? 'Loading…' : tab.title || 'New Tab'}
      </span>
      </button>
      <button
        type="button"
        aria-label={`Close tab: ${tab.title || tab.url || 'New Tab'}`}
        title="Close tab"
        onClick={close}
        className="grid h-full w-8 shrink-0 place-items-center rounded opacity-80 hover:bg-black/15 hover:opacity-100 focus-visible:outline focus-visible:outline-2"
      >
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <path d="M6 6l12 12M6 18L18 6" />
        </svg>
      </button>
    </div>
  );
}
