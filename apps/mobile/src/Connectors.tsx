import { useState } from 'react';
import { CONNECTORS, customConnector, type ConnectorDefinition } from '@bullebrowser/agent-core';
import { Mobile, type MobileState } from './native';

export function Connectors({
  state,
  refresh,
  open,
}: {
  state: MobileState;
  refresh(): Promise<void>;
  open(url: string): Promise<void>;
}) {
  const [query, setQuery] = useState('');
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const catalog: readonly ConnectorDefinition[] = [...CONNECTORS, ...state.customConnectors];
  async function update(enabled: string[], custom = state.customConnectors) {
    setBusy(true);
    setError('');
    try {
      await Mobile.setConnectors({ enabled, custom });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Permission could not be saved.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="settings-section">
      <h2>Connectors</h2>
      <p>
        Use your signed-in websites to finish tasks. Each service keeps its own account permissions.
        Sends and other consequential actions still need your approval.
      </p>
      <p>
        Browser access · not a direct API connection. Disabling removes the assistant shortcut; sign
        out on the website to end its session.
      </p>
      <label>
        Find a connector
        <input
          type="search"
          placeholder="Type a service name…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      {error && <p role="alert">{error}</p>}
      <div className="connector-list">
        {catalog
          .filter((entry) =>
            `${entry.name} ${entry.url} ${entry.description}`
              .toLowerCase()
              .includes(query.toLowerCase()),
          )
          .map((entry) => (
            <div className="connector" key={entry.id}>
              <label>
                <input
                  type="checkbox"
                  checked={state.enabledConnectors.includes(entry.id)}
                  disabled={busy}
                  onChange={(event) =>
                    void update(
                      event.target.checked
                        ? [...state.enabledConnectors, entry.id]
                        : state.enabledConnectors.filter((id) => id !== entry.id),
                    )
                  }
                />
                <span>
                  {entry.name}
                  <small>{entry.description}</small>
                </span>
              </label>
              {state.enabledConnectors.includes(entry.id) && (
                <button
                  disabled={busy || !state.browsing}
                  onClick={() => void open(entry.url).catch((err: Error) => setError(err.message))}
                >
                  Open
                </button>
              )}
              {entry.custom && (
                <button
                  aria-label={`Remove ${entry.name}`}
                  disabled={busy}
                  onClick={() =>
                    void update(
                      state.enabledConnectors.filter((id) => id !== entry.id),
                      state.customConnectors.filter((item) => item.id !== entry.id),
                    )
                  }
                >
                  Remove
                </button>
              )}
            </div>
          ))}
      </div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          try {
            if (state.customConnectors.length >= 50)
              throw new Error('Remove a custom connector before adding another.');
            const entry = customConnector(`custom-${crypto.randomUUID()}`, name, url);
            if (catalog.some((item) => item.url === entry.url))
              throw new Error('This website is already in the catalog.');
            void update(state.enabledConnectors, [...state.customConnectors, entry]).then(() => {
              setName('');
              setUrl('');
            });
          } catch (err) {
            setError((err as Error).message);
          }
        }}
      >
        <h3>Add another service</h3>
        <label>
          Service name
          <input
            value={name}
            maxLength={80}
            onChange={(event) => setName(event.target.value)}
            required
          />
        </label>
        <label>
          HTTPS website
          <input
            type="url"
            placeholder="https://your-service.com"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            required
          />
        </label>
        <button disabled={busy}>Add connector</button>
      </form>
    </section>
  );
}
