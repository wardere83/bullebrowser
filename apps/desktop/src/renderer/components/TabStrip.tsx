import { useRef, useState } from 'react';
import { useBrowserStore } from '../state/browser-store.js';
import type { TabState } from '../../shared/ipc.js';

export function TabStrip() {
  const tabs = useBrowserStore((s) => s.tabs);
  const [dragId, setDragId] = useState<string | null>(null);
  const stripRef = useRef<HTMLDivElement>(null);

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
      ref={stripRef}
      className="flex h-9 items-end gap-0.5 border-b border-line/30 bg-surface-dark px-2 pt-1 text-ink-inverse"
    >
      <div className="flex flex-1 items-end gap-0.5 overflow-x-auto">
        {tabs.map((t) => (
          <Tab
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
        className="ml-1 grid h-7 w-7 place-items-center rounded-md hover:bg-white/10"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M12 5v14M5 12h14" />
        </svg>
      </button>
    </div>
  );
}

function Tab({
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
  const close = (e: React.MouseEvent) => {
    e.stopPropagation();
    void window.bullebrowser.tabs.close(tab.id);
  };
  return (
    <button
      type="button"
      draggable
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      onClick={() => window.bullebrowser.tabs.switch(tab.id)}
      className={`group relative flex h-7 w-[180px] items-center gap-2 rounded-t-md px-2 text-left text-xs transition-colors ${
        tab.active
          ? 'bg-surface-light text-ink-primary shadow-[0_-2px_0_0_#2563EB_inset]'
          : 'bg-white/5 text-ink-inverse/80 hover:bg-white/10'
      }`}
    >
      {tab.faviconUrl ? (
        <img src={tab.faviconUrl} alt="" width={14} height={14} className="rounded-sm" />
      ) : (
        <div className="h-3.5 w-3.5 rounded-sm bg-current opacity-30" />
      )}
      <span className="flex-1 truncate">
        {tab.loading ? 'Loading…' : tab.title || 'New Tab'}
      </span>
      <span
        role="button"
        aria-label="Close tab"
        onClick={close}
        className="grid h-4 w-4 place-items-center rounded-sm opacity-0 hover:bg-black/10 group-hover:opacity-100"
      >
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <path d="M6 6l12 12M6 18L18 6" />
        </svg>
      </span>
    </button>
  );
}
