import { useEffect, useState } from 'react';

export function SearchKeySettings() {
  const [configured, setConfigured] = useState(false);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    void window.bullebrowser.secrets.hasApiKey('brave').then((value) => {
      if (active) setConfigured(value);
    }).catch(() => { if (active) setError('Could not read search configuration.'); });
    return () => { active = false; };
  }, []);
  const update = async (remove: boolean) => {
    setBusy(true);
    setError('');
    try {
      if (remove) await window.bullebrowser.secrets.clearApiKey('brave');
      else await window.bullebrowser.secrets.setApiKey(draft.trim(), 'brave');
      setDraft('');
      setConfigured(await window.bullebrowser.secrets.hasApiKey('brave'));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save search configuration.');
    } finally { setBusy(false); }
  };
  return <section aria-label="Web search" className="space-y-2">
    <h3 className="text-sm font-semibold">Web search</h3>
    <p className="text-xs text-ink-secondary">Search works in your visible browser without a key. Optionally connect Brave Search for API-based discovery. DuckDuckGo is blocked in either mode. Saved keys are encrypted on this device; the operating system may request permission. New tasks use saved changes immediately.</p>
    {configured && <p role="status" className="text-xs">Search key configured</p>}
    <div className="flex gap-2">
      <input type="password" aria-label="Brave Search API key" autoComplete="off" spellCheck={false}
        placeholder={configured ? 'Replacement search key' : 'Brave Search API key'} value={draft}
        onChange={(e) => setDraft(e.target.value)} disabled={busy}
        className="min-w-0 flex-1 rounded border border-line px-3 py-2 text-sm" />
      <button type="button" disabled={busy || !draft.trim()} onClick={() => void update(false)}
        className="rounded bg-primary px-3 py-2 text-sm text-white disabled:opacity-50">{busy ? 'Saving…' : 'Save search key'}</button>
      {configured && <button type="button" disabled={busy} onClick={() => void update(true)} className="text-xs">Remove search key</button>}
    </div>
    {error && <p role="alert" className="text-xs text-red-700">{error}</p>}
  </section>;
}
