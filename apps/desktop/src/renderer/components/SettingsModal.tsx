import { useEffect, useState } from 'react';
import { ASSISTANTS, providerFor, type ModelId } from '@bullebrowser/agent-core';
import { useBrowserStore } from '../state/browser-store.js';
import { useInputActivity } from '../hooks/useInputActivity.js';
import type { AppSettings } from '../../shared/ipc.js';
import { Modal } from './Modal.js';

const MODELS = ASSISTANTS;

export function SettingsModal() {
  const closeSettings = useBrowserStore((s) => s.closeSettings);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [hasKey, setHasKey] = useState(false);
  const setSearchProvider = useBrowserStore((s) => s.setSearchProvider);
  const [keyDraft, setKeyDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [keyError, setKeyError] = useState<string | null>(null);
  // Voice transcription (OpenAI Whisper) needs its own key, independent of the
  // assistant selected for chat, so it remains available across providers.
  const [hasVoiceKey, setHasVoiceKey] = useState(false);
  const [voiceDraft, setVoiceDraft] = useState('');
  const [voiceSaving, setVoiceSaving] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const apiKeyActivity = useInputActivity({ disabled: hasKey || saving });
  const checklistActivity = useInputActivity();

  useEffect(() => {
    void (async () => {
      const next = await window.bullebrowser.settings.get();
      setSettings(next);
      setHasKey(await window.bullebrowser.secrets.hasApiKey(providerFor(next.defaultModel)));
      setHasVoiceKey(await window.bullebrowser.secrets.hasApiKey('openai'));
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
    if (patch.defaultModel) {
      setHasKey(await window.bullebrowser.secrets.hasApiKey(providerFor(next.defaultModel)));
    }
    if (next.searchProvider) {
      setSearchProvider(next.searchProvider);
    }
    setSavedAt(Date.now());
  };

  // Everything below keys off the assistant currently chosen: each engine has
  // its own credential, so switching asks for that engine's key rather than
  // reporting another one as "saved" and then failing auth on the first send.
  const provider = providerFor(settings.defaultModel);
  const assistantLabel = MODELS.find((m) => m.id === settings.defaultModel)?.label ?? 'Assistant';
  const keyPlaceholder = provider === 'openai' ? 'sk-…' : 'sk-ant-…';

  const saveKey = async () => {
    if (!keyDraft.trim()) return;
    setSaving(true);
    setKeyError(null);
    try {
      await window.bullebrowser.secrets.setApiKey(keyDraft.trim(), provider);
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
    await window.bullebrowser.secrets.clearApiKey(provider);
    setHasKey(false);
    setSavedAt(Date.now());
  };

  const saveVoiceKey = async () => {
    if (!voiceDraft.trim()) return;
    setVoiceSaving(true);
    setVoiceError(null);
    try {
      await window.bullebrowser.secrets.setApiKey(voiceDraft.trim(), 'openai');
      setHasVoiceKey(true);
      setVoiceDraft('');
      setSavedAt(Date.now());
    } catch (err) {
      setVoiceError(err instanceof Error ? err.message : 'Failed to save the voice key.');
    } finally {
      setVoiceSaving(false);
    }
  };

  const clearVoiceKey = async () => {
    await window.bullebrowser.secrets.clearApiKey('openai');
    setHasVoiceKey(false);
    setSavedAt(Date.now());
  };

  return (
    <Modal title="Settings" onClose={closeSettings} width={560}>
      <section className="space-y-4">
        <p className="text-xs leading-relaxed text-ink-secondary">
          BulleBrowser works as one assistant — type or speak, and it reads,
          compares, and acts across your tabs. The engine is chosen for you; the
          controls below are optional.
        </p>

        <details open={!hasKey || !hasVoiceKey} className="rounded-lg border border-line/60 bg-surface-muted/20 px-3 py-2">
          <summary className="cursor-pointer select-none text-xs font-semibold uppercase tracking-wide text-ink-secondary">
            Developer / Advanced — engine &amp; keys
          </summary>
          <div className="mt-3 space-y-4">
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-secondary">
            {assistantLabel} key
          </h3>
          <p className="mt-1 text-xs text-ink-secondary">
            Encrypted and stored on this device only — no keychain prompt. Used
            only to call {assistantLabel} directly from your machine.
            {provider === 'openai' && ' This same key also powers voice transcription.'}
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
                <div
                  className={`flex-1 prompt-input-shell prompt-input-shell--${apiKeyActivity.state}`}
                  data-activity-state={apiKeyActivity.state}
                >
                  <input
                    type="password"
                    value={keyDraft}
                    onChange={(e) => {
                      setKeyDraft(e.target.value);
                      apiKeyActivity.onInputActivity();
                      if (keyError) setKeyError(null);
                    }}
                    onPaste={() => apiKeyActivity.onInputActivity()}
                    onFocus={apiKeyActivity.onFocus}
                    onBlur={apiKeyActivity.onBlur}
                    placeholder={keyPlaceholder}
                    className="prompt-input-field prompt-input-field--singleline"
                    disabled={saving}
                  />
                </div>
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

        {provider !== 'openai' && (
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-secondary">
            Voice (OpenAI Whisper) key
          </h3>
          <p className="mt-1 text-xs text-ink-secondary">
            Powers the mic and Voice Mode. Uses your OpenAI key (starts with{' '}
            <code className="rounded bg-surface-muted px-1">sk-</code>) for Whisper
            transcription — separate from the assistant key above. Encrypted and
            stored on this device only.
          </p>
          {hasVoiceKey ? (
            <div className="mt-2 flex items-center gap-2">
              <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700">
                Key saved
              </span>
              <button
                type="button"
                onClick={clearVoiceKey}
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
                  value={voiceDraft}
                  onChange={(e) => {
                    setVoiceDraft(e.target.value);
                    if (voiceError) setVoiceError(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void saveVoiceKey();
                  }}
                  placeholder="sk-…"
                  autoComplete="off"
                  spellCheck={false}
                  className="flex-1 rounded-md border border-line px-3 py-2 font-mono text-xs focus:border-primary focus:outline-none"
                  disabled={voiceSaving}
                />
                <button
                  type="button"
                  onClick={saveVoiceKey}
                  disabled={voiceSaving || !voiceDraft.trim()}
                  className="rounded bg-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-hover disabled:bg-line"
                >
                  {voiceSaving ? 'Saving…' : 'Save'}
                </button>
              </div>
              {voiceError && <div className="text-xs text-danger">{voiceError}</div>}
            </div>
          )}
        </div>
        )}

        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-secondary">
            Assistant
          </h3>
          <select
            value={settings.defaultModel}
            onChange={(e) => update({ defaultModel: e.target.value as ModelId })}
            className="mt-2 rounded border border-line px-2 py-1.5 text-sm"
          >
            {MODELS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </div>
          </div>
        </details>

        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-secondary">
            Search behavior
          </h3>
          <select
            value={settings.searchProvider}
            onChange={(e) =>
              update({ searchProvider: e.target.value as AppSettings['searchProvider'] })
            }
            className="mt-2 rounded border border-line px-2 py-1.5 text-sm"
          >
            <option value="bullebrowser">BulleBrowser</option>
            <option value="google">Google</option>
            <option value="bing">Bing</option>
          </select>
          <p className="mt-2 text-xs text-ink-secondary">
            When you type a query, BulleBrowser will keep you on the BulleBrowser experience.
          </p>
        </div>

        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-secondary">
            Agent
          </h3>
          <label className="mt-2 flex items-center justify-between gap-3 text-sm">
            <span>
              Step budget per task
              <span className="block text-xs text-ink-secondary">
                Navigating and screenshots cost more than quick look-ups. A task that runs out can continue with more.
              </span>
            </span>
            <input
              type="number"
              min={5}
              max={200}
              value={settings.stepBudget}
              onChange={(e) => void update({ stepBudget: Number(e.target.value) || 40 })}
              className="w-20 rounded border border-line px-2 py-1 text-right text-sm"
              aria-label="Step budget per task"
            />
          </label>
          <label className="mt-3 flex items-center justify-between gap-3 text-sm">
            <span>
              Dismiss cookie banners
              <span className="block text-xs text-ink-secondary">
                Chooses the most private option (reject or necessary-only) on common consent banners.
              </span>
            </span>
            <input
              type="checkbox"
              checked={settings.autoDismissConsent}
              onChange={(e) => void update({ autoDismissConsent: e.target.checked })}
              aria-label="Dismiss cookie banners"
            />
          </label>
        </div>

        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-secondary">
            Compliance checklist
          </h3>
          <p className="mt-1 text-xs text-ink-secondary">
            Items the Compliance Review skill checks for. One per line.
          </p>
          <div
            className={`mt-2 prompt-input-shell prompt-input-shell--${checklistActivity.state}`}
            data-activity-state={checklistActivity.state}
          >
            <textarea
              value={settings.complianceChecklist.join('\n')}
              onChange={(e) => {
                checklistActivity.onInputActivity();
                void update({ complianceChecklist: e.target.value.split('\n').filter(Boolean) });
              }}
              onPaste={() => checklistActivity.onInputActivity()}
              onFocus={checklistActivity.onFocus}
              onBlur={checklistActivity.onBlur}
              rows={5}
              className="prompt-input-field w-full font-mono text-xs"
            />
          </div>
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
