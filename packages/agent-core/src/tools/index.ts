import { z } from 'zod';
import type { ToolContext, ToolDefinition, ToolName } from '../types.js';

const EmptyObject = z.object({}).strict();
const NavigateInput = z.object({ url: z.string().url() });
const NavigateOutput = z.object({ url: z.string(), title: z.string() });
const TabIdInput = z.object({ tabId: z.string().optional() });
const ClickInput = z.object({ target: z.string().min(1) });
const TypeInput = z.object({ target: z.string().min(1), text: z.string() });
const ExtractInput = z.object({ schema: z.record(z.unknown()) });
const LinkShape = z.object({ text: z.string(), href: z.string() });
const TabShape = z.object({
  id: z.string(),
  title: z.string(),
  url: z.string(),
  active: z.boolean(),
});

const PageTextOut = z.object({ tabId: z.string(), title: z.string(), url: z.string(), text: z.string() });
const MetaOut = z.object({ tabId: z.string(), title: z.string(), url: z.string() });
const SummaryOut = z.object({ summary: z.string(), citations: z.array(z.string()) });
const ExtractOut = z.object({ data: z.unknown() });
const SelectionOut = z.object({ text: z.string() });
const LinksOut = z.object({ links: z.array(LinkShape) });
const QueryDomOut = z.object({ matches: z.number() });
const ClickOut = z.object({ matched: z.string() });
const TypeOut = z.object({ matched: z.string() });

const SummarizeInput = z.object({
  text: z.string().min(1),
  maxSentences: z.number().int().positive().max(12).optional(),
  sourceUrl: z.string().optional(),
});

const QueryDomInput = z.object({
  selector: z.string().min(1),
  tabId: z.string().optional(),
});

export interface ToolImpl<I, O> extends ToolDefinition<I, O> {
  execute: (input: I, ctx: ToolContext) => Promise<O>;
}

export const tools = {
  getActiveTab: {
    name: 'getActiveTab',
    description: 'Return the active tab metadata.',
    inputSchema: EmptyObject,
    outputSchema: TabShape,
    execute: async (_input, ctx) => {
      const tabs = await ctx.runtime.listTabs();
      const active = tabs.find((t) => t.active) ?? tabs.find((t) => t.id === ctx.activeTabId);
      if (!active) throw new Error('No active tab found.');
      return active;
    },
  } satisfies ToolImpl<z.infer<typeof EmptyObject>, z.infer<typeof TabShape>>,

  listTabs: {
    name: 'listTabs',
    description: 'List all open tabs.',
    inputSchema: EmptyObject,
    outputSchema: z.object({ tabs: z.array(TabShape) }),
    execute: async (_input, ctx) => ({ tabs: await ctx.runtime.listTabs() }),
  } satisfies ToolImpl<z.infer<typeof EmptyObject>, { tabs: z.infer<typeof TabShape>[] }>,

  getPageText: {
    name: 'getPageText',
    description: 'Get readable text from a page.',
    inputSchema: TabIdInput,
    outputSchema: PageTextOut,
    execute: async (input, ctx) => {
      const tabId = input.tabId ?? ctx.activeTabId;
      const page = await ctx.runtime.readPage(tabId);
      return { tabId, title: page.title, url: page.url, text: page.text };
    },
  } satisfies ToolImpl<z.infer<typeof TabIdInput>, z.infer<typeof PageTextOut>>,

  getPageMetadata: {
    name: 'getPageMetadata',
    description: 'Get URL and title for a page.',
    inputSchema: TabIdInput,
    outputSchema: MetaOut,
    execute: async (input, ctx) => {
      const tabId = input.tabId ?? ctx.activeTabId;
      const page = await ctx.runtime.readPage(tabId);
      return { tabId, title: page.title, url: page.url };
    },
  } satisfies ToolImpl<z.infer<typeof TabIdInput>, z.infer<typeof MetaOut>>,

  getSelection: {
    name: 'getSelection',
    description: 'Get selected text from the active page when available.',
    inputSchema: TabIdInput,
    outputSchema: SelectionOut,
    execute: async (input, ctx) => {
      const tabId = input.tabId ?? ctx.activeTabId;
      if (!ctx.runtime.getSelection) return { text: '' };
      return ctx.runtime.getSelection(tabId);
    },
  } satisfies ToolImpl<z.infer<typeof TabIdInput>, z.infer<typeof SelectionOut>>,

  listLinks: {
    name: 'listLinks',
    description: 'List visible page links when available.',
    inputSchema: TabIdInput,
    outputSchema: LinksOut,
    execute: async (input, ctx) => {
      const tabId = input.tabId ?? ctx.activeTabId;
      if (ctx.runtime.listLinks) return { links: await ctx.runtime.listLinks(tabId) };
      const page = await ctx.runtime.readPage(tabId);
      const links = (page.text.match(/https?:\/\/\S+/g) ?? []).slice(0, 100).map((href) => ({
        text: href,
        href,
      }));
      return { links };
    },
  } satisfies ToolImpl<z.infer<typeof TabIdInput>, z.infer<typeof LinksOut>>,

  queryDom: {
    name: 'queryDom',
    description: 'Count DOM matches for a selector when native hook exists.',
    inputSchema: QueryDomInput,
    outputSchema: QueryDomOut,
    execute: async (input, ctx) => {
      const tabId = input.tabId ?? ctx.activeTabId;
      if (!ctx.runtime.queryDom) {
        throw new Error('queryDom is not available in this runtime adapter yet.');
      }
      return ctx.runtime.queryDom(tabId, input.selector);
    },
  } satisfies ToolImpl<z.infer<typeof QueryDomInput>, z.infer<typeof QueryDomOut>>,

  summarizePage: {
    name: 'summarizePage',
    description: 'Create a concise local summary from page text.',
    inputSchema: SummarizeInput,
    outputSchema: SummaryOut,
    execute: async (input) => {
      const maxSentences = input.maxSentences ?? 4;
      const compact = input.text.replace(/\s+/g, ' ').trim();
      const sentences = compact
        .split(/(?<=[.!?])\s+/)
        .filter((s) => s.length > 20)
        .slice(0, maxSentences);
      const summary = sentences.join(' ').slice(0, 2000);
      const citations = input.sourceUrl ? [input.sourceUrl] : [];
      return { summary, citations };
    },
  } satisfies ToolImpl<z.infer<typeof SummarizeInput>, z.infer<typeof SummaryOut>>,

  extractStructuredData: {
    name: 'extractStructuredData',
    description: 'Extract structured data from the page based on a schema.',
    inputSchema: z.object({ schema: z.record(z.unknown()), tabId: z.string().optional() }),
    outputSchema: ExtractOut,
    execute: async (input, ctx) => {
      const tabId = input.tabId ?? ctx.activeTabId;
      return ctx.runtime.extract(tabId, input.schema);
    },
  } satisfies ToolImpl<
    { schema: Record<string, unknown>; tabId?: string },
    z.infer<typeof ExtractOut>
  >,

  navigate: {
    name: 'navigate',
    description: 'Navigate the active tab to a URL.',
    inputSchema: NavigateInput,
    outputSchema: NavigateOutput,
    execute: (input, ctx) => ctx.runtime.navigate(ctx.activeTabId, input.url),
  } satisfies ToolImpl<z.infer<typeof NavigateInput>, z.infer<typeof NavigateOutput>>,

  clickElement: {
    name: 'clickElement',
    description: 'Click an element identified by a selector or visible text.',
    inputSchema: ClickInput,
    outputSchema: ClickOut,
    destructive: true,
    execute: (input, ctx) => ctx.runtime.click(ctx.activeTabId, input.target),
  } satisfies ToolImpl<z.infer<typeof ClickInput>, z.infer<typeof ClickOut>>,

  typeIntoField: {
    name: 'typeIntoField',
    description: 'Type text into a field identified by selector or label.',
    inputSchema: TypeInput,
    outputSchema: TypeOut,
    destructive: true,
    execute: (input, ctx) => ctx.runtime.type(ctx.activeTabId, input.target, input.text),
  } satisfies ToolImpl<z.infer<typeof TypeInput>, z.infer<typeof TypeOut>>,


  // Legacy aliases to preserve compatibility with existing prompts and UX copy.
  read_page: {
    name: 'read_page',
    description: 'Legacy alias for getPageText.',
    inputSchema: TabIdInput,
    outputSchema: z.object({ title: z.string(), url: z.string(), text: z.string() }),
    execute: async (input, ctx) => {
      const tabId = input.tabId ?? ctx.activeTabId;
      return ctx.runtime.readPage(tabId);
    },
  } satisfies ToolImpl<z.infer<typeof TabIdInput>, { title: string; url: string; text: string }>,

  click: {
    name: 'click',
    description: 'Legacy alias for clickElement.',
    inputSchema: ClickInput,
    outputSchema: ClickOut,
    destructive: true,
    execute: (input, ctx) => ctx.runtime.click(ctx.activeTabId, input.target),
  } satisfies ToolImpl<z.infer<typeof ClickInput>, z.infer<typeof ClickOut>>,

  type: {
    name: 'type',
    description: 'Legacy alias for typeIntoField.',
    inputSchema: TypeInput,
    outputSchema: TypeOut,
    destructive: true,
    execute: (input, ctx) => ctx.runtime.type(ctx.activeTabId, input.target, input.text),
  } satisfies ToolImpl<z.infer<typeof TypeInput>, z.infer<typeof TypeOut>>,

  extract: {
    name: 'extract',
    description: 'Legacy alias for extractStructuredData.',
    inputSchema: ExtractInput,
    outputSchema: ExtractOut,
    execute: (input, ctx) => ctx.runtime.extract(ctx.activeTabId, input.schema),
  } satisfies ToolImpl<z.infer<typeof ExtractInput>, z.infer<typeof ExtractOut>>,

  screenshot: {
    name: 'screenshot',
    description: 'Capture the current viewport as PNG.',
    inputSchema: EmptyObject,
    outputSchema: z.object({ pngBase64: z.string() }),
    execute: (_input, ctx) => ctx.runtime.screenshot(ctx.activeTabId),
  } satisfies ToolImpl<z.infer<typeof EmptyObject>, { pngBase64: string }>,

  new_tab: {
    name: 'new_tab',
    description: 'Open a new tab.',
    inputSchema: z.object({ url: z.string().url().optional() }),
    outputSchema: TabShape,
    execute: (input, ctx) => ctx.runtime.newTab(input.url),
  } satisfies ToolImpl<{ url?: string }, z.infer<typeof TabShape>>,

  switch_tab: {
    name: 'switch_tab',
    description: 'Switch active tab.',
    inputSchema: z.object({ tabId: z.string() }),
    outputSchema: TabShape,
    execute: (input, ctx) => ctx.runtime.switchTab(input.tabId),
  } satisfies ToolImpl<{ tabId: string }, z.infer<typeof TabShape>>,

  list_tabs: {
    name: 'list_tabs',
    description: 'Legacy alias for listTabs.',
    inputSchema: EmptyObject,
    outputSchema: z.object({ tabs: z.array(TabShape) }),
    execute: async (_input, ctx) => ({ tabs: await ctx.runtime.listTabs() }),
  } satisfies ToolImpl<z.infer<typeof EmptyObject>, { tabs: z.infer<typeof TabShape>[] }>,

  close_tab: {
    name: 'close_tab',
    description: 'Close tab by id.',
    inputSchema: z.object({ tabId: z.string() }),
    outputSchema: z.object({ closed: z.boolean() }),
    destructive: true,
    execute: (input, ctx) => ctx.runtime.closeTab(input.tabId),
  } satisfies ToolImpl<{ tabId: string }, { closed: boolean }>,

  go_back: {
    name: 'go_back',
    description: 'Navigate backward.',
    inputSchema: EmptyObject,
    outputSchema: z.object({ url: z.string() }),
    execute: (_input, ctx) => ctx.runtime.goBack(ctx.activeTabId),
  } satisfies ToolImpl<z.infer<typeof EmptyObject>, { url: string }>,

  go_forward: {
    name: 'go_forward',
    description: 'Navigate forward.',
    inputSchema: EmptyObject,
    outputSchema: z.object({ url: z.string() }),
    execute: (_input, ctx) => ctx.runtime.goForward(ctx.activeTabId),
  } satisfies ToolImpl<z.infer<typeof EmptyObject>, { url: string }>,

  reload: {
    name: 'reload',
    description: 'Reload tab.',
    inputSchema: EmptyObject,
    outputSchema: z.object({ url: z.string() }),
    execute: (_input, ctx) => ctx.runtime.reload(ctx.activeTabId),
  } satisfies ToolImpl<z.infer<typeof EmptyObject>, { url: string }>,

  scroll: {
    name: 'scroll',
    description: 'Scroll page.',
    inputSchema: z.object({ direction: z.enum(['up', 'down', 'top', 'bottom']), amount: z.number().int().positive().optional() }),
    outputSchema: z.object({ scrolledTo: z.number() }),
    execute: (input, ctx) => ctx.runtime.scroll(ctx.activeTabId, input),
  } satisfies ToolImpl<
    { direction: 'up' | 'down' | 'top' | 'bottom'; amount?: number },
    { scrolledTo: number }
  >,

  press_key: {
    name: 'press_key',
    description: 'Dispatch keyboard event to focused element.',
    inputSchema: z.object({
      key: z.enum(['Enter', 'Tab', 'Escape', 'ArrowDown', 'ArrowUp', 'PageDown', 'PageUp']),
    }),
    outputSchema: z.object({ pressed: z.string() }),
    execute: (input, ctx) => ctx.runtime.pressKey(ctx.activeTabId, input.key),
  } satisfies ToolImpl<
    { key: 'Enter' | 'Tab' | 'Escape' | 'ArrowDown' | 'ArrowUp' | 'PageDown' | 'PageUp' },
    { pressed: string }
  >,

  wait_for: {
    name: 'wait_for',
    description: 'Wait for selector or network idle.',
    inputSchema: z
      .object({
        selector: z.string().optional(),
        networkIdle: z.boolean().optional(),
        timeoutMs: z.number().int().positive().max(10_000).optional(),
      })
      .refine((v) => v.selector || v.networkIdle, {
        message: 'Provide either selector or networkIdle: true',
      }),
    outputSchema: z.object({ matched: z.boolean() }),
    execute: (input, ctx) => ctx.runtime.waitFor(ctx.activeTabId, input),
  } satisfies ToolImpl<
    { selector?: string; networkIdle?: boolean; timeoutMs?: number },
    { matched: boolean }
  >,
} as const;

export type ToolRegistry = typeof tools;

export function getTool(name: string): ToolImpl<unknown, unknown> | undefined {
  return (tools as Record<string, ToolImpl<unknown, unknown>>)[name];
}

export function zodToJsonSchema(schema: z.ZodType<unknown>): Record<string, unknown> {
  if (schema instanceof z.ZodObject) {
    const properties: Record<string, unknown> = {};
    const required: string[] = [];
    const shape = schema.shape as Record<string, z.ZodTypeAny>;
    for (const [key, value] of Object.entries(shape)) {
      properties[key] = zodFieldToJsonSchema(value);
      if (!value.isOptional()) required.push(key);
    }
    const out: Record<string, unknown> = { type: 'object', properties };
    if (required.length > 0) out.required = required;
    return out;
  }
  return zodFieldToJsonSchema(schema as z.ZodTypeAny);
}

function zodFieldToJsonSchema(schema: z.ZodTypeAny): Record<string, unknown> {
  const description = schema.description;
  const wrap = (obj: Record<string, unknown>) =>
    description ? { ...obj, description } : obj;
  if (schema instanceof z.ZodOptional || schema instanceof z.ZodNullable) {
    return zodFieldToJsonSchema(schema.unwrap());
  }
  if (schema instanceof z.ZodEffects) {
    return zodFieldToJsonSchema(schema.innerType());
  }
  if (schema instanceof z.ZodString) return wrap({ type: 'string' });
  if (schema instanceof z.ZodNumber) return wrap({ type: 'number' });
  if (schema instanceof z.ZodBoolean) return wrap({ type: 'boolean' });
  if (schema instanceof z.ZodEnum) {
    return wrap({ type: 'string', enum: schema.options as string[] });
  }
  if (schema instanceof z.ZodArray) {
    return wrap({ type: 'array', items: zodFieldToJsonSchema(schema.element) });
  }
  if (schema instanceof z.ZodRecord) {
    return wrap({ type: 'object', additionalProperties: true });
  }
  if (schema instanceof z.ZodObject) {
    return wrap(zodToJsonSchema(schema));
  }
  if (schema instanceof z.ZodUnknown || schema instanceof z.ZodAny) {
    return wrap({});
  }
  return wrap({});
}

export interface AnthropicToolDef {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export function toAnthropicTools(): AnthropicToolDef[] {
  return Object.values(tools).map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: zodToJsonSchema(t.inputSchema as z.ZodType<unknown>),
  }));
}

export const ALL_TOOL_NAMES: ToolName[] = Object.keys(tools) as ToolName[];
