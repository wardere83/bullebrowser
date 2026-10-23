import type { ToolContext } from './types.js';
import type { MemoryStore } from './memory.js';
import { assertAllowedDestination, assertAllowedTab, BLOCKED_DESTINATION_MESSAGE, isBlockedDestination } from './destinations.js';

export interface RetrievedContext {
  url?: string;
  title?: string;
  textSnippet?: string;
  // Set when a page IS open but its text could not be read (a PDF, a failed
  // load, a viewer plugin). Distinct from "no page open at all" — conflating
  // the two told the model the browser was empty and sent it navigating away
  // from the very page the user was asking about.
  unreadableReason?: string;
  memory: Record<string, unknown>;
}

export async function retrieveContext(
  context: ToolContext,
  memory: MemoryStore,
): Promise<RetrievedContext> {
  try {
    await assertAllowedTab(context, context.activeTabId);
    const page = await context.runtime.readPage(context.activeTabId);
    assertAllowedDestination(page.url);
    return {
      url: page.url,
      title: page.title,
      textSnippet: page.text.slice(0, 8000),
      memory: memory.all(),
    };
  } catch (error) {
    // Ask the runtime where we are even though the text failed, so the model
    // still knows a page is open and which one.
    let url: string | undefined;
    let title: string | undefined;
    try {
      const tabs = await context.runtime.listTabs();
      const active = tabs.find((t) => t.id === context.activeTabId) ?? tabs.find((t) => t.active);
      if (active && isBlockedDestination(active.url)) {
        return { unreadableReason: BLOCKED_DESTINATION_MESSAGE, memory: memory.all() };
      }
      url = active?.url;
      title = active?.title;
    } catch {
      // The runtime is unusable; fall through with no page context.
    }
    return {
      ...(url ? { url } : {}),
      ...(title ? { title } : {}),
      unreadableReason: error instanceof Error ? error.message : 'The page text could not be read.',
      memory: memory.all(),
    };
  }
}
