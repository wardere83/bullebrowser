import { useEffect, useRef, useState } from 'react';
import type { TabSummary } from '@bullebrowser/agent-core';
import { Mobile } from './native';
import { addressDestination } from './address';

export function BrowserToolbar({
  tabs,
  allowed,
  running,
  refresh,
  show,
  onError,
}: {
  tabs: TabSummary[];
  allowed: boolean;
  running: boolean;
  refresh(): Promise<void>;
  show(): Promise<void>;
  onError(message: string): void;
}) {
  const active = tabs.find((tab) => tab.active);
  const [address, setAddress] = useState('');
  const editing = useRef(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!editing.current) setAddress(active?.url ?? '');
  }, [active?.url, active?.id]);
  async function action(name: string, url?: string) {
    setBusy(true);
    try {
      await show();
      await Mobile.browser({ action: name, tabId: active?.id, url });
    } catch (error) {
      onError(error instanceof Error ? error.message : 'The browser action could not complete.');
    } finally {
      setBusy(false);
      await refresh().catch((error: Error) => onError(error.message));
    }
  }
  const disabled = !allowed || running || busy;
  return (
    <div className="browser-toolbar">
      <div className="browser-actions">
        <button
          aria-label="Go back"
          disabled={disabled || !active}
          onClick={() => void action('back')}
        >
          ‹
        </button>
        <button
          aria-label="Go forward"
          disabled={disabled || !active}
          onClick={() => void action('forward')}
        >
          ›
        </button>
        <button
          aria-label="Reload page"
          disabled={disabled || !active}
          onClick={() => void action('reload')}
        >
          ↻
        </button>
        <button
          aria-label="New tab"
          disabled={disabled}
          onClick={() => void action('new', 'https://www.google.com/')}
        >
          +
        </button>
        <button
          aria-label="Close current tab"
          disabled={disabled || !active}
          onClick={() => void action('close')}
        >
          ×
        </button>
      </div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!address.trim()) return;
          try {
            const destination = addressDestination(address);
            editing.current = false;
            void action(active ? 'navigate' : 'new', destination);
          } catch (error) {
            onError((error as Error).message);
          }
        }}
      >
        <label className="sr-only" htmlFor="address">
          Website address or search
        </label>
        <input
          id="address"
          type="text"
          inputMode="url"
          autoCapitalize="none"
          autoCorrect="off"
          placeholder={allowed ? 'Search or enter a website' : 'Enable browsing in Settings'}
          value={address}
          disabled={disabled}
          onChange={(event) => setAddress(event.target.value)}
          onFocus={() => {
            editing.current = true;
            void refresh();
          }}
          onBlur={() => (editing.current = false)}
        />
        <button type="submit" disabled={disabled || !address.trim()}>
          Go
        </button>
      </form>
    </div>
  );
}
