// Tool registry. Each tool exports a Zod schema pair plus an execute()
// function that takes a ToolContext. The Anthropic tool-use definitions
// are derived from the input schemas at startup time via toAnthropicTools.

import { z } from 'zod';
import type { ToolContext, ToolDefinition, ToolName } from '../types.js';

const NavigateInput = z.object({
  url: z.string().url().describe('Absolute http(s) URL to navigate to'),
});
const NavigateOutput = z.object({ url: z.string(), title: z.string() });

const ReadPageInput = z.object({
  tabId: z
    .string()
    .optional()
    .describe(
      'Optional tab id from list_tabs. When omitted, reads the active tab. ' +
        'Use this to silently read background tabs without switching focus.',
    ),
});
const ReadPageOutput = z.object({
  title: z.string(),
  url: z.string(),
  text: z.string(),
});

const ClickInput = z.object({
  target: z
    .string()
    .min(1)
    .describe('A CSS selector or visible text of the element to click'),
});
const ClickOutput = z.object({ matched: z.string() });

const TypeInput = z.object({
  target: z
    .string()
    .min(1)
    .describe('A CSS selector or label text identifying the input field'),
  text: z.string().describe('The text to type into the field'),
});
const TypeOutput = z.object({ matched: z.string() });

const ExtractInput = z.object({
  schema: z
    .record(z.unknown())
    .describe('JSON schema describing the structured shape to extract'),
});
const ExtractOutput = z.object({ data: z.unknown() });

const ScreenshotInput = z.object({}).strict();
const ScreenshotOutput = z.object({
  pngBase64: z.string().describe('Base64-encoded PNG of the current viewport'),
});

const NewTabInput = z.object({
  url: z.string().url().optional().describe('Optional URL to open in the new tab'),
});
const NewTabOutput = z.object({
  id: z.string(),
  title: z.string(),
  url: z.string(),
  active: z.boolean(),
});

const SwitchTabInput = z.object({ tabId: z.string() });
const SwitchTabOutput = NewTabOutput;

const ListTabsInput = z.object({}).strict();
const ListTabsOutput = z.object({ tabs: z.array(NewTabOutput) });

const WaitForInput = z
  .object({
    selector: z.string().optional(),
    networkIdle: z.boolean().optional(),
    timeoutMs: z.number().int().positive().max(10_000).optional(),
  })
  .refine((v) => v.selector || v.networkIdle, {
    message: 'Provide either selector or networkIdle: true',
  });
const WaitForOutput = z.object({ matched: z.boolean() });

const CloseTabInput = z.object({
  tabId: z.string().describe('Id of the tab to close (from list_tabs).'),
});
const CloseTabOutput = z.object({ closed: z.boolean() });

const GoBackInput = z.object({}).strict();
const GoBackOutput = z.object({ url: z.string() });

const GoForwardInput = z.object({}).strict();
const GoForwardOutput = z.object({ url: z.string() });

const ReloadInput = z.object({}).strict();
const ReloadOutput = z.object({ url: z.string() });

const ScrollInput = z.object({
  direction: z
    .enum(['up', 'down', 'top', 'bottom'])
    .describe('Scroll direction: up/down by amount, or jump to top/bottom of page.'),
  amount: z
    .number()
    .int()
    .positive()
    .optional()
    .describe('Pixels to scroll for up/down (default 600). Ignored for top/bottom.'),
});
const ScrollOutput = z.object({ scrolledTo: z.number() });

const PressKeyInput = z.object({
  key: z
    .enum(['Enter', 'Tab', 'Escape', 'ArrowDown', 'ArrowUp', 'PageDown', 'PageUp'])
    .describe(
      'Key to dispatch to the focused element. Use Enter to submit a form ' +
        'after typing into a field; Tab to advance to the next field.',
    ),
});
const PressKeyOutput = z.object({ pressed: z.string() });

export interface ToolImpl<I, O> extends ToolDefinition<I, O> {
  execute: (input: I, ctx: ToolContext) => Promise<O>;
}

export const tools = {
  navigate: {
    name: 'navigate',
    description: 'Navigate the active tab to an absolute URL.',
    inputSchema: NavigateInput,
    outputSchema: NavigateOutput,
    execute: (input, ctx) => ctx.runtime.navigate(ctx.activeTabId, input.url),
  } satisfies ToolImpl<z.infer<typeof NavigateInput>, z.infer<typeof NavigateOutput>>,

  read_page: {
    name: 'read_page',
    description:
      'Return the cleaned, readable text content of a page (no navigation, no scripts). ' +
      'Defaults to the active tab; pass tabId to read a background tab silently.',
    inputSchema: ReadPageInput,
    outputSchema: ReadPageOutput,
    execute: (input, ctx) => ctx.runtime.readPage(input.tabId ?? ctx.activeTabId),
  } satisfies ToolImpl<z.infer<typeof ReadPageInput>, z.infer<typeof ReadPageOutput>>,

  click: {
    name: 'click',
    description: 'Click an element identified by a CSS selector or visible text.',
    inputSchema: ClickInput,
    outputSchema: ClickOutput,
    destructive: true,
    execute: (input, ctx) => ctx.runtime.click(ctx.activeTabId, input.target),
  } satisfies ToolImpl<z.infer<typeof ClickInput>, z.infer<typeof ClickOutput>>,

  type: {
    name: 'type',
    description: 'Type text into a form input identified by selector or label.',
    inputSchema: TypeInput,
    outputSchema: TypeOutput,
    execute: (input, ctx) => ctx.runtime.type(ctx.activeTabId, input.target, input.text),
  } satisfies ToolImpl<z.infer<typeof TypeInput>, z.infer<typeof TypeOutput>>,

  extract: {
    name: 'extract',
    description:
      'Extract structured data from the current page matching the provided JSON schema.',
    inputSchema: ExtractInput,
    outputSchema: ExtractOutput,
    execute: (input, ctx) => ctx.runtime.extract(ctx.activeTabId, input.schema),
  } satisfies ToolImpl<z.infer<typeof ExtractInput>, z.infer<typeof ExtractOutput>>,

  screenshot: {
    name: 'screenshot',
    description: 'Capture the current viewport as a base64-encoded PNG.',
    inputSchema: ScreenshotInput,
    outputSchema: ScreenshotOutput,
    execute: (_input, ctx) => ctx.runtime.screenshot(ctx.activeTabId),
  } satisfies ToolImpl<z.infer<typeof ScreenshotInput>, z.infer<typeof ScreenshotOutput>>,

  new_tab: {
    name: 'new_tab',
    description: 'Open a new browser tab, optionally navigating to a URL.',
    inputSchema: NewTabInput,
    outputSchema: NewTabOutput,
    execute: (input, ctx) => ctx.runtime.newTab(input.url),
  } satisfies ToolImpl<z.infer<typeof NewTabInput>, z.infer<typeof NewTabOutput>>,

  switch_tab: {
    name: 'switch_tab',
    description: 'Switch to a previously opened tab by id.',
    inputSchema: SwitchTabInput,
    outputSchema: SwitchTabOutput,
    execute: (input, ctx) => ctx.runtime.switchTab(input.tabId),
  } satisfies ToolImpl<z.infer<typeof SwitchTabInput>, z.infer<typeof SwitchTabOutput>>,

  list_tabs: {
    name: 'list_tabs',
    description: 'Return all open tabs with id, title, and URL.',
    inputSchema: ListTabsInput,
    outputSchema: ListTabsOutput,
    execute: async (_input, ctx) => ({ tabs: await ctx.runtime.listTabs() }),
  } satisfies ToolImpl<z.infer<typeof ListTabsInput>, z.infer<typeof ListTabsOutput>>,

  wait_for: {
    name: 'wait_for',
    description:
      'Wait for a CSS selector to appear, or for network idle. Hard cap at 10 seconds.',
    inputSchema: WaitForInput,
    outputSchema: WaitForOutput,
    execute: (input, ctx) => ctx.runtime.waitFor(ctx.activeTabId, input),
  } satisfies ToolImpl<z.infer<typeof WaitForInput>, z.infer<typeof WaitForOutput>>,

  close_tab: {
    name: 'close_tab',
    description: 'Close a tab by id. The user can reopen via history if needed.',
    inputSchema: CloseTabInput,
    outputSchema: CloseTabOutput,
    destructive: true,
    execute: (input, ctx) => ctx.runtime.closeTab(input.tabId),
  } satisfies ToolImpl<z.infer<typeof CloseTabInput>, z.infer<typeof CloseTabOutput>>,

  go_back: {
    name: 'go_back',
    description: 'Navigate the active tab back one entry in its history.',
    inputSchema: GoBackInput,
    outputSchema: GoBackOutput,
    execute: (_input, ctx) => ctx.runtime.goBack(ctx.activeTabId),
  } satisfies ToolImpl<z.infer<typeof GoBackInput>, z.infer<typeof GoBackOutput>>,

  go_forward: {
    name: 'go_forward',
    description: 'Navigate the active tab forward one entry in its history.',
    inputSchema: GoForwardInput,
    outputSchema: GoForwardOutput,
    execute: (_input, ctx) => ctx.runtime.goForward(ctx.activeTabId),
  } satisfies ToolImpl<z.infer<typeof GoForwardInput>, z.infer<typeof GoForwardOutput>>,

  reload: {
    name: 'reload',
    description: 'Reload the active tab.',
    inputSchema: ReloadInput,
    outputSchema: ReloadOutput,
    execute: (_input, ctx) => ctx.runtime.reload(ctx.activeTabId),
  } satisfies ToolImpl<z.infer<typeof ReloadInput>, z.infer<typeof ReloadOutput>>,

  scroll: {
    name: 'scroll',
    description:
      'Scroll the active page up/down by an amount, or jump to top/bottom. ' +
      'Use after read_page if more content is below the fold.',
    inputSchema: ScrollInput,
    outputSchema: ScrollOutput,
    execute: (input, ctx) => ctx.runtime.scroll(ctx.activeTabId, input),
  } satisfies ToolImpl<z.infer<typeof ScrollInput>, z.infer<typeof ScrollOutput>>,

  press_key: {
    name: 'press_key',
    description:
      'Dispatch a key (Enter, Tab, Escape, ArrowUp/Down, PageUp/Down) to the ' +
      'focused element. Use Enter after type to submit a search or form.',
    inputSchema: PressKeyInput,
    outputSchema: PressKeyOutput,
    execute: (input, ctx) => ctx.runtime.pressKey(ctx.activeTabId, input.key),
  } satisfies ToolImpl<z.infer<typeof PressKeyInput>, z.infer<typeof PressKeyOutput>>,
} as const;

export type ToolRegistry = typeof tools;

export function getTool(name: string): ToolImpl<unknown, unknown> | undefined {
  return (tools as Record<string, ToolImpl<unknown, unknown>>)[name];
}

/**
 * Convert a Zod object schema to a JSON schema fragment shaped for the
 * Anthropic tool-use API. We only need the "type/properties/required"
 * envelope, so we walk the schema rather than pulling in a full converter.
 */
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
