import type { TabState } from '../../shared/ipc.js';

/** Failed native loads need a visible recovery page instead of the intro. */
export function BrowserPane({ tab }: { tab: TabState | undefined }) {
  if (!tab?.loadError) return null;
  return (
    <section aria-label="Page loading error" className="flex h-full items-center justify-center px-8 py-12">
      <div className="w-full max-w-lg text-ink-primary">
        <h1 className="mb-3 text-2xl font-semibold">Page could not load</h1>
        <p className="text-sm text-ink-secondary">{tab.loadError.message}</p>
        <p className="mt-4 break-all text-sm text-ink-secondary">{tab.url}</p>
        <div className="mt-6 flex gap-3">
          <button
            type="button"
            onClick={() => void window.bullebrowser.tabs.navigate(tab.id, tab.url).catch(() => {})}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90"
          >
            Retry
          </button>
          <button
            type="button"
            disabled={!tab.canGoBack}
            onClick={() => void window.bullebrowser.tabs.back(tab.id).catch(() => {})}
            className="rounded-md border border-line px-4 py-2 text-sm disabled:opacity-40"
          >
            Go back
          </button>
        </div>
      </div>
    </section>
  );
}
