// Live integration test — exercises the real agent loop against the Anthropic
// API with a scripted (in-memory) browser. Proves that different prompts drive
// real browsing and yield distinct, task-specific answers (the Task 1 bug was
// near-identical output for every prompt).
//
// Skipped automatically when ANTHROPIC_API_KEY is unset (e.g. in CI), so it
// never fails the normal suite. Run locally with the key exported:
//   export $(grep '^ANTHROPIC_API_KEY=' ../../.env) && pnpm --filter \
//     @bullebrowser/agent-core exec vitest run src/agent-loop.live.test.ts

import { describe, expect, it } from 'vitest';
import { runAgent } from './agent-loop.js';
import type { AgentStep, ClaudeModelId, ToolContext, ToolRuntime } from './types.js';

const MODEL: ClaudeModelId = 'claude-sonnet-4-6';

const SYSTEM = [
  'You are the BulleBrowser agent with control of a web browser.',
  'Tools: navigate, read_page, extract, list_tabs, click, type, press_key, scroll, wait_for.',
  'To find information you do not already have, use web_search, then navigate',
  'directly to a relevant source URL and read_page before answering.',
  'Always read a page before answering; ground answers in what you read. Be concise.',
].join('\n');

// A tiny scripted "web": navigation resolves to page-specific source content,
// while the injected web_search tool supplies synthetic discovery results.
function scriptedRuntime(startUrl: string, startPage: { title: string; text: string }) {
  let current = { url: startUrl, title: startPage.title, text: startPage.text };

  const resolve = (url: string): { title: string; text: string } => {
    const u = url.toLowerCase();
    if (u.includes('france.example')) return { title: 'France', text: 'Paris is the capital of France.' };
    if (u.includes('example.com')) {
      return {
        title: 'Example Domain',
        text: 'Example Domain. This domain is for use in illustrative examples in documents. You may use this domain in literature without prior coordination or asking for permission.',
      };
    }
    return { title: new URL(url).hostname, text: `Page at ${url}. No notable content.` };
  };

  const runtime: ToolRuntime = {
    async navigate(_tabId, url) {
      const page = resolve(url);
      current = { url, title: page.title, text: page.text };
      return { url, title: page.title };
    },
    async readPage() {
      return { title: current.title, url: current.url, text: current.text };
    },
    async click(_tabId, target) {
      return { matched: target };
    },
    async type(_tabId, target) {
      return { matched: target };
    },
    async extract() {
      return { data: { heading: current.title, url: current.url, text: current.text.slice(0, 300) } };
    },
    async screenshot() {
      return { pngBase64: 'iVBORw0KGgo=' };
    },
    async newTab(url) {
      return { id: 't2', title: 'New', url: url ?? 'about:blank', active: true };
    },
    async switchTab(tabId) {
      return { id: tabId, title: current.title, url: current.url, active: true };
    },
    async listTabs() {
      return [{ id: 't1', title: current.title, url: current.url, active: true }];
    },
    async closeTab() {
      return { closed: true };
    },
    async goBack() {
      return { url: current.url };
    },
    async goForward() {
      return { url: current.url };
    },
    async reload() {
      return { url: current.url };
    },
    async scroll() {
      return { scrolledTo: 0 };
    },
    async pressKey(_tabId, key) {
      return { pressed: key };
    },
    async waitFor() {
      return { matched: true };
    },
    async confirmDestructive() {
      return true;
    },
  };
  return runtime;
}

async function ask(
  userMessage: string,
  runtime: ToolRuntime,
): Promise<{ text: string; tools: string[] }> {
  const tools: string[] = [];
  const context: ToolContext = {
    activeTabId: 't1',
    signal: new AbortController().signal,
    runtime,
  };
  const text = await runAgent({
    apiKey: process.env.ANTHROPIC_API_KEY,
    model: MODEL,
    systemPrompt: SYSTEM,
    history: [],
    userMessage,
    extraTools: [{
      name: 'web_search', description: 'Search for source URLs, then open and read them.',
      inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
      requiresBrowseAccess: true,
      execute: async () => ({ results: [{ title: 'France', url: 'https://france.example/capital', snippet: 'France and its capital.' }] }),
    }],
    context,
    onStep: (s: AgentStep) => {
      if (s.type === 'tool_call' && s.toolName) tools.push(s.toolName);
    },
  });
  return { text: text.trim(), tools };
}

describe.skipIf(!process.env.ANTHROPIC_API_KEY)('runAgent live browsing (real API)', () => {
  it('produces distinct, browsing-driven answers for three different prompts', async () => {
    // 1) Open a URL and summarize it.
    const r1 = await ask(
      'Open https://example.com and tell me in one sentence what the page is about.',
      scriptedRuntime('about:blank', { title: 'Home', text: 'Start page.' }),
    );
    // 2) Search the web for a fact.
    const r2 = await ask(
      'Search the web for the capital of France and tell me what it is.',
      scriptedRuntime('about:blank', { title: 'Home', text: 'Start page.' }),
    );
    // 3) Extract data from the already-open page.
    const r3 = await ask(
      'Extract the main heading of the current page and quote its first sentence.',
      scriptedRuntime('https://example.com/', {
        title: 'Example Domain',
        text: 'Example Domain. This domain is for use in illustrative examples in documents.',
      }),
    );

    // Log for human inspection of the verification run.
    console.log('\n--- LIVE VERIFICATION ---');
    for (const [i, r] of [r1, r2, r3].entries()) {
      console.log(`Prompt ${i + 1}: tools=[${r.tools.join(', ')}]`);
      console.log(`Answer ${i + 1}: ${r.text.replace(/\s+/g, ' ').slice(0, 200)}\n`);
    }

    // Each prompt actually drove the browser.
    expect(r1.tools.length, 'prompt 1 invoked tools').toBeGreaterThan(0);
    expect(r2.tools.length, 'prompt 2 invoked tools').toBeGreaterThan(0);
    expect(r3.tools.length, 'prompt 3 invoked tools').toBeGreaterThan(0);
    expect(r1.tools).toContain('navigate');
    expect(r2.tools).toContain('web_search');
    expect(r2.tools).toContain('navigate'); // opened an actual source
    expect(r1.tools.concat(r2.tools, r3.tools)).toContain('read_page');

    // Answers are grounded in the pages that were read.
    expect(r2.text.toLowerCase()).toContain('paris');
    expect(r1.text.toLowerCase()).toMatch(/example|domain|illustrative/);

    // The three answers are distinct (the core Task 1 regression).
    expect(r1.text).not.toEqual(r2.text);
    expect(r2.text).not.toEqual(r3.text);
    expect(r1.text).not.toEqual(r3.text);
  }, 180_000);
});
