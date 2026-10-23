import { useEffect, useState } from 'react';
import { useBrowserStore } from '../state/browser-store.js';
import type { ConnectorState } from '@bullebrowser/agent-core';

export function ConnectorsSettings() {
  const closeSettings = useBrowserStore((state) => state.closeSettings);
  const [states, setStates] = useState<ConnectorState[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  useEffect(() => {
    void window.bullebrowser.connectors
      .list()
      .then(setStates)
      .catch(() => setError('Connectors could not be loaded.'));
  }, []);
  async function perform(action: () => Promise<ConnectorState[] | unknown>) {
    setBusy(true);
    setError('');
    try {
      await action();
      setStates(await window.bullebrowser.connectors.list());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The connector could not be updated.');
    } finally {
      setBusy(false);
    }
  }
  const matches = states?.filter((entry) =>
    `${entry.name} ${entry.description} ${entry.url}`.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <details className="rounded-lg border border-line/60 bg-surface-muted/20 px-3 py-2" open>
      <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-ink-secondary">
        Connectors
      </summary>
      <p className="mt-2 text-xs text-ink-secondary">
        Search services or add your own. These connectors work through the service’s real website,
        using your signed-in browser session. Sends, submissions and other consequential actions
        still ask for approval.
      </p>
      <p className="mt-2 text-xs text-ink-secondary">
        Turning one off removes its assistant shortcut. It does not sign you out or block ordinary
        browsing. Permissions apply to this device.
      </p>
      <label className="mt-3 block text-xs">
        Find a connector
        <input
          className="mt-1 w-full rounded border border-line bg-transparent px-3 py-2 text-sm"
          type="search"
          placeholder="Type a service name…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      {error && (
        <p role="alert" className="mt-2 text-xs text-red-700">
          {error}
        </p>
      )}
      {!states && !error && (
        <p role="status" className="mt-2 text-xs">
          Loading connectors…
        </p>
      )}
      {matches?.length === 0 && (
        <p className="mt-3 text-xs">No match. Add the service’s website below.</p>
      )}
      <div className="mt-3 max-h-64 space-y-3 overflow-y-auto">
        {matches?.map((entry) => (
          <div key={entry.id} className="flex items-center gap-3">
            <label className="flex flex-1 items-center gap-3 text-sm">
              <input
                type="checkbox"
                checked={entry.enabled}
                disabled={busy}
                onChange={(event) =>
                  void perform(() =>
                    window.bullebrowser.connectors.set(entry.id, event.target.checked),
                  )
                }
              />
              <span>
                {entry.name}
                <span className="block text-xs text-ink-secondary">{entry.description}</span>
              </span>
            </label>
            {entry.enabled && (
              <button
                className="rounded border border-line px-2 py-1 text-xs focus-visible:ring-2"
                disabled={busy}
                onClick={() => void perform(async () => { await window.bullebrowser.connectors.open(entry.id); closeSettings(); })}
              >
                Open / sign in
              </button>
            )}
            {entry.custom && (
              <button
                aria-label={`Remove ${entry.name}`}
                className="text-xs underline"
                disabled={busy}
                onClick={() => void perform(() => window.bullebrowser.connectors.remove(entry.id))}
              >
                Remove
              </button>
            )}
          </div>
        ))}
      </div>
      <form
        className="mt-4 space-y-2 border-t border-line pt-3"
        onSubmit={(event) => {
          event.preventDefault();
          void perform(async () => {
            await window.bullebrowser.connectors.add(name, url);
            setName('');
            setUrl('');
          });
        }}
      >
        <h3 className="text-xs font-semibold">Add a custom website connector</h3>
        <input
          aria-label="Service name"
          className="w-full rounded border border-line bg-transparent px-3 py-2 text-sm"
          placeholder="Service name"
          maxLength={80}
          value={name}
          onChange={(event) => setName(event.target.value)}
          required
        />
        <input
          aria-label="Service HTTPS address"
          className="w-full rounded border border-line bg-transparent px-3 py-2 text-sm"
          type="url"
          placeholder="https://your-service.com"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          required
        />
        <button
          disabled={busy || !name.trim() || !url.trim()}
          className="rounded border border-line px-3 py-2 text-xs"
        >
          Add connector
        </button>
      </form>
    </details>
  );
}
