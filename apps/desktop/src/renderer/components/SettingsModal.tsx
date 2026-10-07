import { useEffect, useRef, useState } from 'react';
import { ASSISTANTS, providerFor, type ModelId } from '@bullebrowser/agent-core';
import { useBrowserStore } from '../state/browser-store.js';
import { useInputActivity } from '../hooks/useInputActivity.js';
import type { AppSettings } from '../../shared/ipc.js';
import { takeAssistantSettingsRequest } from '../workspace/settings-intent.js';
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
  const apiKeyActivity = useInputActivity({ disabled: hasKey || saving });
  // The workspace's "connect an assistant" link opens Settings for one thing;
  // show that section unfolded instead of leaving the user to find it.
  const revealAssistant = useRef(false);
  const assistantSection = useRef<HTMLDetailsElement>(null);
  const loaded = settings !== null;

  useEffect(() => {
    void (async () => {
      const next = await window.bullebrowser.settings.get();
      setSettings(next);
      setHasKey(await window.bullebrowser.secrets.hasApiKey(providerFor(next.defaultModel)));
    })();
  }, []);

  useEffect(() => {
    if (takeAssistantSettingsRequest()) revealAssistant.current = true;
  }, []);

  useEffect(() => {
    const section = assistantSection.current;
    if (!loaded || !revealAssistant.current || !section) return;
    revealAssistant.current = false;
    section.open = true;
    section.scrollIntoView({ block: 'nearest' });
  }, [loaded]);

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

  return (
    <Modal title="Settings" onClose={closeSettings} width={560}>
      <section className="space-y-4">
        <p className="text-xs leading-relaxed text-ink-secondary">
          BulleBrowser helps your organization find funding opportunities, understand funder
          priorities, assess its alignment and develop proposals ethically. Everything on this
          page is optional.
        </p>

        <p className="text-xs leading-relaxed text-ink-secondary">
          Without a connected assistant, these still work: document search and verbatim passages
          in the Organization Knowledge Hub, the funding finder, and text matches in funding
          documents. Written analysis needs a connected assistant.
        </p>

        <p className="text-xs leading-relaxed text-ink-secondary">
          Voice input and Voice Mode transcribe English on this device without a key. The speech
          model downloads on first use; after that, transcription works offline.
        </p>

        <details
          ref={assistantSection}
          className="rounded-lg border border-line/60 bg-surface-muted/20 px-3 py-2"
        >
          <summary className="cursor-pointer select-none text-xs font-semibold uppercase tracking-wide text-ink-secondary">
            Connect an assistant (optional)
          </summary>
          <div className="mt-3 space-y-4">
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-secondary">
            {assistantLabel} key
          </h3>
          <p className="mt-1 text-xs text-ink-secondary">
            Connect {assistantLabel} for written analysis: profile proposals, summaries of
            funding documents, alignment assessments and proposal guides. Your key is encrypted
            and stored on this device. When you ask for analysis, relevant excerpts of your
            documents go directly to the provider you connect, under your own key.
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
                    aria-label={`${assistantLabel} key`}
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
                <div role="alert" className="text-xs text-red-700">
                  {keyError}
                </div>
              )}
            </div>
          )}
        </div>

        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-secondary">
            Assistant
          </h3>
          <p className="mt-1 text-xs text-ink-secondary">
            The assistant that writes analysis and answers in the chat panel. Each one uses its
            own key.
          </p>
          <select
            value={settings.defaultModel}
            onChange={(e) => update({ defaultModel: e.target.value as ModelId })}
            aria-label="Assistant"
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
            aria-label="Search behavior"
            className="mt-2 rounded border border-line px-2 py-1.5 text-sm"
          >
            <option value="bullebrowser">BulleBrowser</option>
            <option value="google">Google</option>
            <option value="bing">Bing</option>
          </select>
          <p className="mt-2 text-xs text-ink-secondary">
            Where words typed into the address bar go: to the assistant, which is the BulleBrowser
            choice, or to a search engine in the current tab.
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
                How far the assistant may go when it browses for you, for example to read a
                funder’s page. Navigating and screenshots cost more than quick look-ups, and a task
                that runs out can continue with more.
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
            History
          </h3>
          <button
            type="button"
            onClick={() => window.bullebrowser.history.clear()}
            className="mt-2 rounded border border-line px-3 py-1.5 text-sm hover:bg-surface-muted"
          >
            Clear browsing history
          </button>
          <p className="mt-2 text-xs text-ink-secondary">
            Removes the list of pages you have visited. Your organizations, documents and funding
            work are not affected.
          </p>
        </div>

        {savedAt && (
          <div className="text-xs text-ink-secondary">Saved.</div>
        )}
      </section>
    </Modal>
  );
}
