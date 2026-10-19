// Product-level destination restrictions. Use exact DNS boundaries, not substrings.
const BLOCKED_HOSTS = ['duckduckgo.com', 'duck.com', 'ddg.gg'];
export const BLOCKED_DESTINATION_MESSAGE = 'This destination is blocked by BulleBrowser policy. Use an official source or another permitted search provider.';

export function isBlockedDestination(value: string): boolean {
  try {
    const host = new URL(value).hostname.toLowerCase().replace(/\.+$/, '');
    return BLOCKED_HOSTS.some((domain) => host === domain || host.endsWith(`.${domain}`));
  } catch { return false; }
}

export function assertAllowedDestination(value: string): void {
  if (isBlockedDestination(value)) throw new Error(BLOCKED_DESTINATION_MESSAGE);
}
