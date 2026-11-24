/**
 * Where the address bar goes for what was typed: an HTTPS address as given, a
 * bare host (with an optional port or path) over HTTPS, or otherwise a search.
 * Throws for anything that is not an HTTPS website.
 */
export function addressDestination(input: string): string {
  const value = input.trim();
  // "example.com:8443" is a host and port, not a URL scheme named "example.com".
  const host = /^[^\s/:]+\.[a-z]{2,}(?::\d{1,5})?(?:[/?#]|$)/i.test(value);
  const destination =
    !host && /^[a-z][a-z\d+.-]*:/i.test(value)
      ? value
      : host
        ? `https://${value}`
        : `https://www.google.com/search?q=${encodeURIComponent(value)}`;
  const url = new URL(destination);
  if (url.protocol !== 'https:' || url.username || url.password)
    throw new Error('Enter an HTTPS website or a search.');
  return url.href;
}
