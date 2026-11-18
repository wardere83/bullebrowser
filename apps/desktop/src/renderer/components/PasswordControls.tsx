import { useEffect, useState } from 'react';
import type { PasswordOffer, PasswordState } from '../../shared/ipc.js';

const siteOf = (origin: string) => {
  try { return new URL(origin).host; } catch { return origin; }
};

// Saved passwords in the top bar: a key button that fills the page's sign-in
// form with a saved login, and the offer to save a sign-in just used. Both
// live in BulleBrowser's own chrome, which a page cannot draw over or fake.
export function PasswordControls({ tabId }: { tabId?: string }) {
  const [states, setStates] = useState<Record<string, PasswordState>>({});
  const [offer, setOffer] = useState<PasswordOffer | null>(null);
  const [problem, setProblem] = useState('');

  useEffect(() => window.bullebrowser.passwords.onState((state) => setStates((all) => ({ ...all, [state.tabId]: state }))), []);
  useEffect(() => window.bullebrowser.passwords.onOffer(setOffer), []);

  const state = tabId ? states[tabId] : undefined;
  const canFill = !!tabId && !!state?.hasForm && state.logins.length > 0;

  const reply = (choice: 'save' | 'never' | 'dismiss') => {
    if (!offer) return;
    void window.bullebrowser.passwords.replyOffer(offer.id, choice).catch(() => {});
    setOffer(null);
  };

  const fill = () => {
    if (!tabId) return;
    setProblem('');
    void window.bullebrowser.passwords.fill(tabId).catch(() => setProblem('That saved password is not for this site.'));
  };

  return (
    <>
      {canFill && (
        <button
          type="button"
          onClick={fill}
          aria-label="Fill saved password"
          title={state!.logins.length === 1 ? `Fill the saved password for ${state!.logins[0]!.username || 'this site'}` : 'Choose a saved password to fill'}
          className="no-drag flex h-7 shrink-0 items-center gap-1 rounded-md px-2 text-xs text-ink-secondary hover:bg-surface-muted hover:text-ink-primary"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <circle cx="7.5" cy="15.5" r="4.5" /><path d="m10.7 12.3 9.3-9.3M17 6l3 3M14 9l2 2" />
          </svg>
          {problem ? <span role="alert">{problem}</span> : null}
        </button>
      )}
      {offer && (
        <div role="group" aria-label="Save password" className="no-drag flex shrink-0 items-center gap-2 rounded-full bg-primary/10 px-3 py-1 text-xs text-ink-primary">
          <span className="max-w-[260px] truncate">
            {offer.update ? 'Update' : 'Save'} password for {siteOf(offer.origin)}{offer.username ? ` (${offer.username})` : ''}?
          </span>
          <button type="button" onClick={() => reply('save')} className="rounded bg-primary px-2 py-0.5 text-[11px] text-white">
            {offer.update ? 'Update' : 'Save'}
          </button>
          <button type="button" onClick={() => reply('never')} className="rounded px-2 py-0.5 text-[11px] hover:bg-line">Never for this site</button>
          <button type="button" onClick={() => reply('dismiss')} aria-label="Not now" className="rounded px-1 text-[11px] hover:bg-line">✕</button>
        </div>
      )}
    </>
  );
}
