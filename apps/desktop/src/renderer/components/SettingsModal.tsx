import { useEffect, useState } from 'react';
import type { ClaudeModelId } from '@bullebrowser/agent-core';
import { useBrowserStore } from '../state/browser-store.js';
import type { AppSettings } from '../../shared/ipc.js';
import { Modal } from './Modal.js';

const MODELS: { id: ClaudeModelId; label: string }[] = [
  { id: 'claude-opus-4-7', label: 'Claude Opus 4.7' },
  { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
  { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5' },
];

export function SettingsModal() {
  const closeSettings = useBrowserStore((s) => s.closeSettings);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [hasKey, setHasKey] = useState(false);
  const [keyDraft, setKeyDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [keyError, setKeyError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      setSettings(await window.bullebrowser.settings.get());
      setHasKey(await window.bullebrowser.secrets.hasApiKey());
    })();
  }, []);

  if (!settings) {
    return (
      <Modal title="Settings" onClose={closeSettings}>
        <div className="text-sm text-ink-secondary">Loading…</div>
      </Modal>
    );
  }

  const update = async (patch: Partial<AppSettings>) => {
    const next = await window.bullebrowser.settings.set(patch);
    setSettings(next);
    setSavedAt(Date.now());
  };

  const saveKey = async () => {
    if (!keyDraft.trim()) return;
    setSaving(true);
    setKeyError(null);
    try {
      await window.bullebrowser.secrets.setApiKey(keyDraft.trim());
      setHasKey(true);
      setKeyDraft('');
      setSavedAt(Date.now());
    } catch (err) {
      setKeyError(err instanceof Error ? err.message : 'Failed to save API key.');
    } finally {
      setSaving(false);
    }
  };

  const clearKey = async () => {
    await window.bullebrowser.secrets.clearApiKey();
    setHasKey(false);
    setSavedAt(Date.now());
  };

  return (
    <Modal title="Settings" onClose={closeSettings} width={560}>
      <section className="space-y-4">
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-secondary">
            Anthropic API key
          </h3>
          <p className="mt-1 text-xs text-ink-secondary">
            Stored encrypted in your OS keychain. Used only to call the
            Anthropic API directly from this device.
          </p>
          {hasKey ? (
            <div className="mt-2 flex items-center gap-2">
              <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700">
                Key saved
              </span>
              <button
                type="button"
                onClick={clearKey}
                className="rounded border border-line px-2 py-1 text-xs hover:bg-surface-muted"
              >
                Remove key
              </button>
            </div>
          ) : (
            <div className="mt-2 space-y-2">
              <div className="flex gap-2">
                <input
                  type="password"
                  value={keyDraft}
                  onChange={(e) => {
                    setKeyDraft(e.target.value);
                    if (keyError) setKeyError(null);
                  }}
                  placeholder="sk-ant-…"
                  className="flex-1 rounded border border-line px-2 py-1.5 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                />
                <button
                  type="button"
                  onClick={saveKey}
                  disabled={saving || !keyDraft.trim()}
                  className="rounded bg-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-hover disabled:bg-line"
                >
                  {saving ? 'Saving…' : 'Save'}
                </button>
              </div>
              {keyError && (
                <div className="text-xs text-danger">{keyError}</div>
              )}
            </div>
          )}
        </div>

        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-secondary">
            Default model
          </h3>
          <select
            value={settings.defaultModel}
            onChange={(e) => update({ defaultModel: e.target.value as ClaudeModelId })}
            className="mt-2 rounded border border-line px-2 py-1.5 text-sm"
          >
            {MODELS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-secondary">
            Search engine
          </h3>
          <select
            value={settings.searchProvider}
            onChange={(e) =>
              update({ searchProvider: e.target.value as AppSettings['searchProvider'] })
            }
            className="mt-2 rounded border border-line px-2 py-1.5 text-sm"
          >
            <option value="duckduckgo">DuckDuckGo</option>
            <option value="google">Google</option>
            <option value="bing">Bing</option>
          </select>
        </div>

        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-secondary">
            Compliance checklist
          </h3>
          <p className="mt-1 text-xs text-ink-secondary">
            Items the Compliance Review skill checks for. One per line.
          </p>
          <textarea
            value={settings.complianceChecklist.join('\n')}
            onChange={(e) =>
              update({ complianceChecklist: e.target.value.split('\n').filter(Boolean) })
            }
            rows={5}
            className="mt-2 w-full rounded border border-line p-2 font-mono text-xs"
          />
        </div>

        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-secondary">
            History
          </h3>
          <button
            type="button"
            onClick={() => window.bullebrowser.history.clear()}
            className="mt-2 rounded border border-line px-3 py-1.5 text-sm hover:bg-surface-muted"
          >
            Clear browsing history
          </button>
        </div>

        {savedAt && (
          <div className="text-xs text-ink-secondary">Saved.</div>
        )}
      </section>
    </Modal>
  );
}
