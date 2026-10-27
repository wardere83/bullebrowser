import { ToolError } from './errors.js';
import type { ToolContext } from './types.js';

// This is a product restriction, independent of search-provider settings,
// model instructions, browsing consent, or a conversation's previous steps.
// Stable host fingerprints keep restricted provider names out of prompts and bundles.
// This is an identifier, not a secret or a cryptographic authenticity check.
export function destinationFingerprint(value: string): string {
  let hash = 14695981039346656037n;
  for (const character of value.toLowerCase()) {
    hash = BigInt.asUintN(64, (hash ^ BigInt(character.charCodeAt(0))) * 1099511628211n);
  }
  return hash.toString(16).padStart(16, '0');
}
const BLOCKED_HOST_FINGERPRINTS = new Set(['2fbb5d9759a7d9c8', '898a63955bf7867b', '835d4b4de592220e']);


export const BLOCKED_DESTINATION_MESSAGE =
  'This destination is blocked by BulleBrowser policy. Use web_search for discovery and open an allowed source directly.';

export function isBlockedDestination(input: string | URL): boolean {
  let raw = String(input).trim();
  // Opaque URLs can retain the origin of an already-open page.
  raw = raw.replace(/^(?:blob|filesystem):/i, '');
  try {
    const hasProtocol = /^[a-z][a-z\d+.-]*:/i.test(raw);
    const bareHostWithPort = /^[^/?#]+:\d+(?:[/?#]|$)/.test(raw);
    const candidate = raw.startsWith('//') ? `https:${raw}` : !hasProtocol || bareHostWithPort ? `https://${raw}` : raw;
    const url = new URL(candidate);
    const host = url.hostname.toLowerCase().replace(/\.+$/, '');
    const labels = host.split('.');
    return labels.some((_, index) => BLOCKED_HOST_FINGERPRINTS.has(destinationFingerprint(labels.slice(index).join('.'))));
  } catch {
    // URL validity and allowed schemes are checked by the caller. An invalid
    // address must not make an unrelated page look like a blocked hostname.
    return false;
  }
}

export function assertAllowedDestination(input: string | URL): void {
  if (isBlockedDestination(input)) throw new ToolError('BLOCKED_BY_POLICY', BLOCKED_DESTINATION_MESSAGE);
}

/** Check tab metadata before touching page text, DOM, screenshots or inputs. */
export async function assertAllowedTab(context: ToolContext, tabId: string): Promise<void> {
  const tab = (await context.runtime.listTabs()).find((candidate) => candidate.id === tabId);
  if (tab) assertAllowedDestination(tab.url);
}

const PAGE_TOOLS = new Set([
  'getActiveTab', 'read_page', 'getPageText', 'getPageMetadata', 'getSelection', 'listLinks',
  'queryDom', 'extractStructuredData', 'click', 'clickElement', 'type', 'typeIntoField',
  'extract', 'screenshot', 'switch_tab', 'go_back', 'go_forward', 'reload', 'scroll',
  'press_key', 'select_option', 'find_elements', 'wait_for',
]);

// Other tools always act on context.activeTabId. An unrecognized tabId field
// must not redirect the safety check away from the page they will actually use.
const TAB_ID_TOOLS = new Set([
  'read_page', 'getPageText', 'getPageMetadata', 'getSelection', 'listLinks',
  'queryDom', 'extractStructuredData', 'switch_tab',
]);

/** Returns the checked page target for post-action verification, when present. */
export async function assertAllowedToolDestination(
  name: string, input: Record<string, unknown>, context: ToolContext,
): Promise<string | undefined> {
  if ((name === 'navigate' || name === 'new_tab') && typeof input.url === 'string') {
    assertAllowedDestination(input.url);
  }
  if (name === 'summarizePage' && typeof input.sourceUrl === 'string') assertAllowedDestination(input.sourceUrl);
  if (name === 'getActiveTab') {
    const tabs = await context.runtime.listTabs();
    const tab = tabs.find((candidate) => candidate.active) ?? tabs.find((candidate) => candidate.id === context.activeTabId);
    if (tab) assertAllowedDestination(tab.url);
    return tab?.id;
  }
  if (PAGE_TOOLS.has(name)) {
    const tabId = TAB_ID_TOOLS.has(name) && typeof input.tabId === 'string' ? input.tabId : context.activeTabId;
    await assertAllowedTab(context, tabId);
    return tabId;
  }
}
