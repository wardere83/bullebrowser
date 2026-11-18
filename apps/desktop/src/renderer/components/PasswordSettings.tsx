import { useEffect, useState } from 'react';
import type { SavedLoginSummary } from '../../shared/ipc.js';

const siteOf = (origin: string) => {
  try { return new URL(origin).host; } catch { return origin; }
};

// Saved passwords: the logins BulleBrowser fills, and an import from Apple
// Passwords, Chrome or Firefox. Passwords themselves are never shown here.
export function PasswordSettings() {
  const [logins, setLogins] = useState<SavedLoginSummary[]>([]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const refresh = async () => setLogins(await window.bullebrowser.passwords.list());
  useEffect(() => { void refresh().catch(() => setError('Could not read saved passwords.')); }, []);

  const importFile = async () => {
    setBusy(true);
    setError('');
    setNote('');
    try {
      const result = await window.bullebrowser.passwords.importFile();
      if (result) {
        setNote(`Imported ${result.imported} ${result.imported === 1 ? 'password' : 'passwords'}` +
          (result.skipped ? `; skipped ${result.skipped} without a secure website.` : '.') +
          ' You can now delete the exported file.');
        await refresh();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '') : 'Could not import that file.');
    } finally { setBusy(false); }
  };

  const remove = async (login: SavedLoginSummary) => {
    if (!confirm(`Delete the saved password for ${login.username || 'this login'} on ${siteOf(login.origin)}?`)) return;
    await window.bullebrowser.passwords.remove(login.id);
    await refresh();
  };

  return <section aria-label="Passwords" className="space-y-2">
    <h3 className="text-sm font-semibold">Passwords</h3>
    <p className="text-xs text-ink-secondary">
      BulleBrowser offers to save a password when you sign in, and fills it with the key button in the address bar next
      time. Passwords are encrypted with the macOS Keychain, filled only into the site they were saved for, and never
      shared with the assistant. To bring in passwords you already have, export them from the Passwords app (File → Export
      All Passwords), Chrome or Firefox, then import the file here.
    </p>
    <div className="flex items-center gap-2">
      <button type="button" disabled={busy} onClick={() => void importFile()}
        className="rounded border border-line px-3 py-2 text-sm disabled:opacity-50">{busy ? 'Importing…' : 'Import passwords…'}</button>
      <span className="text-xs text-ink-secondary">{logins.length} saved</span>
    </div>
    {note && <p role="status" className="text-xs">{note}</p>}
    {error && <p role="alert" className="text-xs text-red-700">{error}</p>}
    {logins.length > 0 && (
      <ul aria-label="Saved passwords" className="max-h-48 divide-y divide-line/30 overflow-y-auto rounded border border-line/40">
        {logins.map((login) => (
          <li key={login.id} className="flex items-center gap-2 px-3 py-1.5 text-xs">
            <span className="min-w-0 flex-1 truncate" title={login.origin}>{siteOf(login.origin)}</span>
            <span className="min-w-0 flex-1 truncate text-ink-secondary">{login.username || '(no username)'}</span>
            <button type="button" onClick={() => void remove(login)} className="text-ink-secondary hover:text-danger"
              aria-label={`Delete saved password for ${login.username || 'login'} on ${siteOf(login.origin)}`}>Delete</button>
          </li>
        ))}
      </ul>
    )}
  </section>;
}
