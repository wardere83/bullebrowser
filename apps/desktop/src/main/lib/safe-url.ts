// Central URL allowlist for anything that ends up in webContents.loadURL
// or shell.openExternal. The agent's tools, the address bar IPC, the
// new-tab handler, and the chrome window-open handler all flow through
// here so we have one chokepoint for scheme policy.
//
// Why: WebContentsView.loadURL happily loads file:// and javascript:.
// Without an allowlist a single prompt like "open file:///etc/passwd"
// turns the agent into a local-file read primitive; a malicious page
// calling window.open('file:///…') would do the same via the tab
// new-window handler.

const SAFE_TAB_SCHEMES = new Set(['http:', 'https:', 'about:']);
const SAFE_EXTERNAL_SCHEMES = new Set(['http:', 'https:', 'mailto:']);

function parse(raw: string): URL | null {
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}

/**
 * Validate a URL that will be loaded inside a tab's WebContents.
 * Returns the normalised URL string, or throws with an agent/IPC-readable
 * message. Used by every code path that calls loadURL.
 */
export function assertSafeTabUrl(raw: string): string {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) throw new Error('URL is empty.');
  const parsed = parse(trimmed);
  if (!parsed) {
    throw new Error(`Refusing to load malformed URL: ${truncate(trimmed)}`);
  }
  if (!SAFE_TAB_SCHEMES.has(parsed.protocol)) {
    throw new Error(
      `Refusing to load ${parsed.protocol} URL in a tab. ` +
        `Only http, https, and about: are allowed.`,
    );
  }
  return parsed.toString();
}

/**
 * Same policy, but for shell.openExternal — additionally allows mailto:
 * since the OS handles it safely, and refuses everything else (custom
 * protocols, file://, javascript:, etc.).
 */
export function assertSafeExternalUrl(raw: string): string {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) throw new Error('URL is empty.');
  const parsed = parse(trimmed);
  if (!parsed) {
    throw new Error(`Refusing to open malformed URL: ${truncate(trimmed)}`);
  }
  if (!SAFE_EXTERNAL_SCHEMES.has(parsed.protocol)) {
    throw new Error(
      `Refusing to open ${parsed.protocol} URL externally. ` +
        `Only http, https, and mailto: are allowed.`,
    );
  }
  return parsed.toString();
}

function truncate(s: string): string {
  return s.length > 120 ? `${s.slice(0, 117)}…` : s;
}
