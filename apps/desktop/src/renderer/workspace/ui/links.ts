// Which addresses the workspace will open. Links shown in the workspace come
// from official sources and from documents, so they are checked before they
// are handed to the browser: only ordinary web addresses open.

/**
 * The address to open, or null when it is not an http or https address the
 * browser should be sent to.
 */
export function safeExternalUrl(href: string | null | undefined): string | null {
  const raw = (href ?? '').trim();
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (!url.hostname) return null;
  // An address that carries a user name or password is not one to click through.
  if (url.username || url.password) return null;
  return url.href;
}

/** The site an address belongs to, for showing beside a link: "grants.example.gov". */
export function linkHost(href: string | null | undefined): string {
  const safe = safeExternalUrl(href);
  if (!safe) return '';
  return new URL(safe).hostname.replace(/^www\./, '');
}
