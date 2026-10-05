import type { ToolCallOutcome } from './agent-loop.js';
import { StepBudget } from './budget.js';
import type { AgentInput } from './types.js';

type Call = (name: string, input: Record<string, unknown>) => Promise<ToolCallOutcome>;

// The original local-first assistant used explicit commands and extractive
// summaries. Keep that capability without pretending to be a cloud model.
export async function runLocalAgent(input: AgentInput, call: Call): Promise<string> {
  const message = input.userMessage.trim();
  const help = 'I can summarize the current page, list tabs, show page details, open a URL, list links, extract page data, click "a target", or type "text" into "a field".';
  let report: string;
  const budget = new StepBudget(input.budget);
  const run = async (name: string, args: Record<string, unknown> = {}): Promise<Record<string, unknown>> => {
    if (input.context.signal.aborted) throw new Error('cancelled');
    if (!budget.charge(name).ok) throw new Error('Step budget exhausted.');
    const result = await call(name, args);
    if (input.context.signal.aborted) throw new Error('cancelled');
    if (result.isError) throw new Error(result.text);
    // executeToolCall contains and neutralizes page data for cloud callers.
    // Local commands consume it only as data, never as another instruction.
    const data = result.text.replace(/^<untrusted_page_data[^>]*>\n/, '').replace(/\n<\/untrusted_page_data>$/, '');
    return JSON.parse(data) as Record<string, unknown>;
  };
  const navigate = message.match(/^(?:please\s+)?(?:open|go to|navigate to)\s+(\S+)\s*$/i);
  const click = message.match(/^(?:please\s+)?(?:click|tap|press)\s+["']([^"']+)["']\s*$/i);
  const type = message.match(/^(?:please\s+)?(?:type|enter)\s+["']([^"']*)["']\s+(?:into|in)\s+["']([^"']+)["']\s*$/i);
  if (navigate) {
    const page = await run('navigate', { url: navigate[1] });
    report = `Opened ${String(page.title ?? '')}\n${String(page.url ?? '')}`;
  } else if (/^(?:please\s+)?(?:list|show|what)\s+(?:are\s+)?(?:the\s+)?(?:open\s+)?tabs\??$/i.test(message)) {
    const result = await run('listTabs');
    const tabs = result.tabs as Array<{ title: string; url: string }>;
    report = tabs.length ? tabs.map((tab) => `${tab.title}\n${tab.url}`).join('\n\n') : 'There are no open tabs.';
  } else if (/^(?:show\s+)?(?:page details|metadata|title|url of this page)\??$/i.test(message)) {
    const page = await run('getPageMetadata');
    report = `${String(page.title ?? '')}\n${String(page.url ?? '')}`;
  } else if (/^(?:please\s+)?(?:list|show)\s+(?:the\s+)?links(?: on (?:this|the) page)?\s*$/i.test(message)) {
    const result = await run('listLinks');
    const links = result.links as Array<{ text: string; href: string }>;
    report = links.length ? links.slice(0, 50).map((link) => `${link.text}\n${link.href}`).join('\n\n') : 'No links were found.';
  } else if (/^(?:please\s+)?extract(?:\s+(?:structured\s+)?(?:page\s+)?data)?(?:\s+(?:from\s+)?(?:this|the)\s+page)?\s*$/i.test(message)) {
    const result = await run('extract', { schema: {
      type: 'object', properties: { title: { type: 'string' }, keyPoints: { type: 'array', items: { type: 'string' } } }, required: ['title'],
    } });
    report = JSON.stringify(result.data, null, 2);
  } else if (click) {
    await run('click', { target: click[1] });
    report = `Clicked "${click[1]}".`;
  } else if (type) {
    await run('type', { target: type[2], text: type[1] });
    report = `Entered text into "${type[2]}".`;
  } else if (/^(?:please\s+)?(?:summari[sz]e|summary|read|what (?:does this page say|is this page about))\b/i.test(message)) {
    const page = await run('read_page');
    const result = await run('summarizePage', { text: String(page.text ?? ''), sourceUrl: String(page.url ?? '') });
    report = result.summary ? `${String(result.summary)}\n\nSource: ${String(page.url ?? '')}` : 'This page has no readable text to summarize.';
  } else {
    report = `Local assistant is ready. ${help}`;
  }
  input.onStep({ type: 'text', detail: report });
  input.onStep({ type: 'done' });
  return report;
}
