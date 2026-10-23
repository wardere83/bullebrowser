import { ToolError } from './errors.js';
import type { ToolContext } from './types.js';

// This is a product restriction, independent of search-provider settings,
// model instructions, browsing consent, or a conversation's previous steps.
const BLOCKED_HOSTS = ['duckduckgo.com', 'duck.com', 'ddg.gg'] as const;

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
    return BLOCKED_HOSTS.some((blocked) => host === blocked || host.endsWith(`.${blocked}`));
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

/** Shared by execution and direct registry callers, including legacy aliases. */
export async function assertAllowedToolDestination(
  name: string, input: Record<string, unknown>, context: ToolContext,
): Promise<void> {
  if ((name === 'navigate' || name === 'new_tab') && typeof input.url === 'string') {
    assertAllowedDestination(input.url);
  }
  if (name === 'summarizePage' && typeof input.sourceUrl === 'string') assertAllowedDestination(input.sourceUrl);
  if (PAGE_TOOLS.has(name)) {
    await assertAllowedTab(context, typeof input.tabId === 'string' ? input.tabId : context.activeTabId);
  }
}
