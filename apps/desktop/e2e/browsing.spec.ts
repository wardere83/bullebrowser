import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { createServer, type Server } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PAGE_HELPERS } from '../src/main/agent/browser/page-scripts';

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

type Hooks = {
  tabManager: {
    getActiveId(): string;
    getView(id: string): Electron.WebContentsView;
  };
  runtime: { readPage(tabId: string): Promise<unknown> };
};

type ReadProbe = { entered: number; release: (() => void) | null };

async function launch(extraArgs: string[] = [], openAiFixture = false) {
  const userData = mkdtempSync(join(tmpdir(), 'bullebrowser-browsing-'));
  const env = {
    ...process.env,
    NODE_ENV: 'test',
    BULLEBROWSER_TEST_HOOKS: '1',
    ANTHROPIC_API_KEY: '',
    OPENAI_API_KEY: openAiFixture ? 'sk-e2e-test-only-key' : '',
    BRAVE_SEARCH_API_KEY: 'fixture-search-key-not-real',
  };
  delete (env as NodeJS.ProcessEnv).ELECTRON_RUN_AS_NODE;
  let app: ElectronApplication | undefined;
  try {
    app = await electron.launch({
      cwd: appRoot,
      args: ['.', '--no-sandbox', `--user-data-dir=${userData}`, ...extraArgs],
      env,
    });
    const win = await app.firstWindow({ timeout: 20_000 });
    await expect(win.getByRole('heading', { name: 'Where should we browse?', exact: true })).toBeVisible();
    await expect.poll(() => win.evaluate(async () => (await window.bullebrowser.tabs.list()).filter((tab) => tab.active).length)).toBe(1);
    const testApp = app;
    await expect.poll(() => testApp.evaluate(() => Boolean((globalThis as Record<string, unknown>).__bbTest))).toBe(true);
    return {
      app: testApp,
      win,
      close: async () => {
        await testApp.close();
        rmSync(userData, { recursive: true, force: true });
      },
    };
  } catch (error) {
    await app?.close().catch(() => {});
    rmSync(userData, { recursive: true, force: true });
    throw error;
  }
}

function serverForPages(): Server {
  return createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://fixture.local');
    res.setHeader('Cache-Control', 'no-store');
    if (url.pathname === '/fixture.js') {
      res.setHeader('Content-Type', 'application/javascript');
      res.end("document.querySelector('input')?.addEventListener('input',event=>document.querySelector('output').textContent=event.target.value);document.querySelector('#page-action')?.addEventListener('click',()=>document.querySelector('output').textContent='Page button clicked');");
      return;
    }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    const heading = url.pathname === '/two' ? 'Application details'
      : url.pathname === '/submitted' ? 'Application submitted'
      : url.pathname === '/search' ? 'Search fixture results'
      : 'Community funding source';
    // User input is rendered as text; the controlled fixture never embeds it
    // as HTML or script and never contacts an external service.
    const submitted = url.searchParams.get('entity') ?? url.searchParams.get('q') ?? '';
    const safeText = submitted.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
    res.end(`<!doctype html><html><head><title>${heading}</title><script defer src="/fixture.js"></script><style>body{margin:0;color:#182436;background:#f8fafc;font:18px system-ui}main{padding:32px}input,button{font:inherit;padding:12px;margin:8px 0}a,output{display:block;margin:16px 0}</style></head><body><main><h1>${heading}</h1><p>Eligible CBOs can request workforce funding. Applications close on December 15.</p><p id="result">${safeText}</p><a href="/two">Read application details</a><form action="/submitted" method="get"><label>Entity name <input name="entity" aria-label="Entity name" autocomplete="off"></label><button type="submit">Submit application</button></form><button id="page-action">Page interaction</button><output>Ready</output></main></body></html>`);
  });
}

async function fixture(port = 0) {
  const server = serverForPages();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  const actualPort = (server.address() as { port: number }).port;
  return {
    url: `http://127.0.0.1:${actualPort}`,
    port: actualPort,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}

async function enterAddress(win: Page, text: string) {
  const address = win.getByRole('textbox', { name: 'Address bar', exact: true });
  await address.fill(text);
  await address.press('Enter');
}

async function pageState(app: ElectronApplication) {
  return app.evaluate(async ({ BrowserWindow }) => {
    const manager = (globalThis as unknown as { __bbTest: Hooks }).__bbTest.tabManager;
    const view = manager.getView(manager.getActiveId());
    return {
      url: view.webContents.getURL(),
      visible: view.getVisible(),
      attached: BrowserWindow.getAllWindows()[0]!.contentView.children.includes(view),
      bounds: view.getBounds(),
      document: await view.webContents.executeJavaScript("({title:document.title,heading:document.querySelector('h1')?.textContent,output:document.querySelector('output')?.textContent,result:document.querySelector('#result')?.textContent,width:innerWidth,height:innerHeight})"),
    };
  });
}

async function expectPage(app: ElectronApplication, win: Page, url: string, heading: string) {
  await expect.poll(async () => {
    const state = await pageState(app);
    return { url: state.url, heading: state.document.heading, visible: state.visible, attached: state.attached };
  }).toEqual({ url, heading, visible: true, attached: true });
  await expect(win.getByRole('textbox', { name: 'Address bar', exact: true })).toHaveValue(url);
  await expect(win.getByRole('region', { name: 'BulleBrowser funding introduction' })).toBeHidden();
}

async function clickPage(app: ElectronApplication, selector: string) {
  await app.evaluate(async (_electron, target) => {
    const manager = (globalThis as unknown as { __bbTest: Hooks }).__bbTest.tabManager;
    const wc = manager.getView(manager.getActiveId()).webContents;
    const point = await wc.executeJavaScript(`(()=>{const rect=document.querySelector(${JSON.stringify(target)}).getBoundingClientRect();return {x:Math.round(rect.x+rect.width/2),y:Math.round(rect.y+rect.height/2)};})()`);
    wc.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...point });
    wc.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...point });
  }, selector);
}

async function expectNativeBounds(app: ElectronApplication, win: Page) {
  await expect.poll(async () => {
    const geometry = await win.evaluate(() => {
      const chrome = document.querySelector('header')!;
      const strip = chrome.nextElementSibling!;
      const assistant = document.querySelector('aside')!;
      return { top: strip.getBoundingClientRect().bottom, right: assistant.getBoundingClientRect().left, height: innerHeight };
    });
    const { bounds, document: page } = await pageState(app);
    return {
      x: bounds.x,
      topDifference: Math.abs(bounds.y - geometry.top),
      rightDifference: Math.abs(bounds.width - geometry.right),
      bottomDifference: Math.abs(bounds.y + bounds.height - geometry.height),
      widthDifference: Math.abs(page.width - bounds.width),
      heightDifference: Math.abs(page.height - bounds.height),
    };
  }).toEqual({ x: 0, topDifference: 0, rightDifference: 0, bottomDifference: 0, widthDifference: 0, heightDifference: 0 });
}

async function holdActualPageRead(app: ElectronApplication, once = false) {
  await app.evaluate((_electron, holdOnce) => {
    const runtime = (globalThis as unknown as { __bbTest: Hooks }).__bbTest.runtime;
    const prototype = Object.getPrototypeOf(runtime);
    const original = prototype.readPage;
    const probe: ReadProbe = { entered: 0, release: null };
    (globalThis as Record<string, unknown>).__browsingRead = probe;
    prototype.readPage = async function (tabId: string) {
      if (holdOnce) prototype.readPage = original;
      // Only pause after the real runtime has read the real native document.
      // The agent's consent, tool events, answer and storage run normally.
      const result = await original.call(this, tabId);
      probe.entered += 1;
      await new Promise<void>((resolve) => { probe.release = resolve; });
      return result;
    };
  }, once);
}

async function releasePageRead(app: ElectronApplication) {
  await app.evaluate(() => {
    const probe = (globalThis as unknown as { __browsingRead?: ReadProbe }).__browsingRead;
    probe?.release?.();
    if (probe) probe.release = null;
  });
}

test('address navigation shows an interactive native page with working history and resize bounds', async () => {
  const site = await fixture();
  const { app, win, close } = await launch();
  try {
    await enterAddress(win, `${site.url}/one`);
    await expectPage(app, win, `${site.url}/one`, 'Community funding source');
    await expectNativeBounds(app, win);

    await clickPage(app, '#page-action');
    await expect.poll(async () => (await pageState(app)).document.output).toBe('Page button clicked');
    await clickPage(app, 'input[name="entity"]');
    await app.evaluate(async () => {
      const manager = (globalThis as unknown as { __bbTest: Hooks }).__bbTest.tabManager;
      await manager.getView(manager.getActiveId()).webContents.insertText('Riverbend CBO');
    });
    await expect.poll(async () => (await pageState(app)).document.output).toBe('Riverbend CBO');
    await clickPage(app, 'button[type="submit"]');
    await expectPage(app, win, `${site.url}/submitted?entity=Riverbend+CBO`, 'Application submitted');
    expect((await pageState(app)).document.result).toBe('Riverbend CBO');

    await win.getByRole('button', { name: 'Back', exact: true }).click();
    await expectPage(app, win, `${site.url}/one`, 'Community funding source');
    await win.getByRole('button', { name: 'Forward', exact: true }).click();
    await expectPage(app, win, `${site.url}/submitted?entity=Riverbend+CBO`, 'Application submitted');
    await win.getByRole('button', { name: 'Back', exact: true }).click();
    await expectPage(app, win, `${site.url}/one`, 'Community funding source');
    await clickPage(app, 'a[href="/two"]');
    await expectPage(app, win, `${site.url}/two`, 'Application details');

    for (const size of [{ width: 1100, height: 700 }, { width: 960, height: 600 }]) {
      await app.evaluate(({ BrowserWindow }, next) => BrowserWindow.getAllWindows()[0]!.setContentSize(next.width, next.height), size);
      await expectNativeBounds(app, win);
      await clickPage(app, '#page-action');
      await expect.poll(async () => (await pageState(app)).document.output).toBe('Page button clicked');
    }
    await win.getByRole('button', { name: 'Reload', exact: true }).click();
    await expect.poll(async () => (await pageState(app)).document.output).toBe('Ready');
    await expectNativeBounds(app, win);
    // Plain local addresses also load a page instead of becoming chat tasks.
    await enterAddress(win, `localhost:${site.port}/one`);
    await expectPage(app, win, `http://localhost:${site.port}/one`, 'Community funding source');
    await enterAddress(win, `127.0.0.1:${site.port}/two`);
    await expectPage(app, win, `${site.url}/two`, 'Application details');
    expect(await win.locator('.md-prose').count()).toBe(0);
  } finally {
    await close();
    await site.close();
  }
});

test('a full history disk preserves saved history and keeps native browsing interactive', async () => {
  const site = await fixture();
  const { app, win, close } = await launch();
  try {
    await enterAddress(win, `${site.url}/one`);
    await expectPage(app, win, `${site.url}/one`, 'Community funding source');
    await expect.poll(() => win.evaluate(() => window.bullebrowser.history.list())).toEqual(
      expect.arrayContaining([expect.objectContaining({ url: `${site.url}/one` })]),
    );
    await app.evaluate(({ app }) => {
      const { createRequire } = process.getBuiltinModule('node:module');
      const { join } = process.getBuiltinModule('node:path');
      const require = createRequire(join(app.getAppPath(), 'package.json'));
      const { default: Store } = require('electron-store');
      const original = Store.prototype._write;
      const probe = { failures: 0, restore: () => { Store.prototype._write = original; } };
      (globalThis as Record<string, unknown>).__historyDiskProbe = probe;
      Store.prototype._write = function (data: unknown) {
        if (this.path.endsWith('/history.json') || this.path.endsWith('\\history.json')) {
          probe.failures++;
          throw Object.assign(new Error('Simulated full history disk'), { code: 'ENOSPC' });
        }
        return original.call(this, data);
      };
    });
    await enterAddress(win, `${site.url}/two`);
    await expectPage(app, win, `${site.url}/two`, 'Application details');
    await clickPage(app, '#page-action');
    await expect.poll(async () => (await pageState(app)).document.output).toBe('Page button clicked');
    await enterAddress(win, `${site.url}/one`);
    await expectPage(app, win, `${site.url}/one`, 'Community funding source');
    expect(await app.evaluate(() => (globalThis as unknown as {
      __historyDiskProbe: { failures: number };
    }).__historyDiskProbe.failures)).toBe(1);
    const saved = await win.evaluate(() => window.bullebrowser.history.list());
    expect(saved.some((entry) => entry.url === `${site.url}/one`)).toBe(true);
    expect(saved.some((entry) => entry.url === `${site.url}/two`)).toBe(false);
  } finally {
    await app.evaluate(() => (globalThis as unknown as {
      __historyDiskProbe?: { restore(): void };
    }).__historyDiskProbe?.restore()).catch(() => {});
    await close();
    await site.close();
  }
});

test('bare hostnames and search settings navigate real pages through the address bar', async () => {
  const site = await fixture();
  const { app, win, close } = await launch();
  try {
    // Only HTTPS transport is redirected to a controlled local server. The
    // parser, IPC, tab manager and native document rendering remain real.
    await app.evaluate(({ session }, localUrl) => {
      session.defaultSession.protocol.handle('https', (request) => {
        const url = new URL(request.url);
        if (!['funding.example', 'xn--bcher-kva.example', 'www.google.com', 'www.bing.com'].includes(url.hostname)) {
          return new Response('Unexpected fixture origin', { status: 404 });
        }
        return fetch(`${localUrl}${url.pathname}${url.search}`);
      });
    }, site.url);
    await enterAddress(win, 'funding.example/one');
    await expectPage(app, win, 'https://funding.example/one', 'Community funding source');
    for (const [input, expected] of [
      ['funding.example?entity=Workforce#evidence', 'https://funding.example/?entity=Workforce#evidence'],
      ['funding.example:8443/one?entity=Workforce#evidence', 'https://funding.example:8443/one?entity=Workforce#evidence'],
      ['bücher.example/one', 'https://xn--bcher-kva.example/one'],
    ]) {
      await enterAddress(win, input!);
      await expectPage(app, win, expected!, 'Community funding source');
    }

    for (const engine of ['google', 'bing']) {
      await win.getByRole('button', { name: 'Profile menu', exact: true }).click();
      await win.getByRole('button', { name: 'Settings', exact: true }).click();
      const settings = win.getByRole('dialog', { name: 'Settings', exact: true });
      await settings.getByRole('combobox', { name: 'Search behavior', exact: true }).selectOption(engine);
      await expect.poll(() => win.evaluate(async () => (await window.bullebrowser.settings.get()).searchProvider)).toBe(engine);
      await settings.getByRole('button', { name: 'Close', exact: true }).click();
      await enterAddress(win, 'community funding & workforce');
      await expectPage(app, win, `https://www.${engine}.com/search?q=community%20funding%20%26%20workforce`, 'Search fixture results');
      expect((await pageState(app)).document.result).toBe('community funding & workforce');
      await expectNativeBounds(app, win);
    }
    expect(await win.locator('.md-prose').count()).toBe(0);
  } finally {
    await close();
    await site.close();
  }
});

test('the keyless address-bar assistant browses only after approval and reads the loaded source', async () => {
  const site = await fixture();
  const { app, win, close } = await launch();
  try {
    await enterAddress(win, `go to ${site.url}/one`);
    const allow = win.getByRole('button', { name: 'Allow Access', exact: true });
    await expect(allow).toBeVisible();
    expect((await pageState(app)).visible).toBe(false);
    expect((await pageState(app)).url).toBe('about:blank');
    await allow.click();
    await expectPage(app, win, `${site.url}/one`, 'Community funding source');
    await expect(win.locator('.md-prose')).toContainText('Community funding source');
    await expect(win.locator('aside').getByRole('button', { name: 'Stop', exact: true })).toBeHidden();
    await holdActualPageRead(app);
    await enterAddress(win, 'summarize this page');
    await expect(allow).toBeVisible();
    await allow.click();
    await expect.poll(() => app.evaluate(() => (globalThis as unknown as { __browsingRead: ReadProbe }).__browsingRead.entered)).toBe(1);
    const activity = win.getByRole('region', { name: 'Task activity', exact: true });
    const steps = activity.getByRole('log', { name: 'Browser task steps', exact: true });
    await expect(activity.getByRole('button', { name: 'Toggle task activity', exact: true })).toHaveAttribute('aria-expanded', 'true');
    await expect(steps).toBeVisible();
    await expect(steps).toContainText('Reading the page');
    await expect(steps).toContainText('In progress');
    await expect(win.locator('.md-prose')).toHaveCount(1);
    await releasePageRead(app);
    await expect(win.locator('.md-prose')).toHaveCount(2);
    await expect(win.locator('.md-prose').last()).toContainText('Applications close on December 15');
    await expect(win.locator('.md-prose').last()).toContainText(`${site.url}/one`);
    await expect(win.locator('aside').getByRole('button', { name: 'Stop', exact: true })).toBeHidden();
    // Completed steps stay associated with the completed answer. They can be
    // reviewed after the running view folds up, without starting another task.
    await expect(activity.getByRole('button', { name: 'Toggle task activity', exact: true })).toHaveAttribute('aria-expanded', 'false');
    await activity.getByRole('button', { name: 'Toggle task activity', exact: true }).click();
    await expect(steps).toContainText('Reading the page');
    await expect(steps).toContainText('Done');
    await expect(steps).not.toContainText('In progress');
    await expectNativeBounds(app, win);

    // Completion refreshes must preserve keyboard focus on an existing source
    // link. Use another real keyless task without moving focus to its composer.
    const sourceLink = win.locator('.md-prose').nth(1).getByRole('link', { name: `${site.url}/one`, exact: true });
    await sourceLink.focus();
    const originalAnchor = await sourceLink.elementHandle();
    await expect(sourceLink).toBeFocused();
    await win.evaluate(() => window.dispatchEvent(new CustomEvent('bullebrowser:agent-prompt', {
      detail: 'How was BulleBrowser built?',
    })));
    await expect(win.locator('.md-prose')).toHaveCount(3);
    await expect(win.locator('.md-prose').last().getByRole('link', { name: 'support@bullebrowser.com', exact: true })).toBeVisible();
    await expect(win.locator('aside').getByRole('button', { name: 'Stop', exact: true })).toBeHidden();
    expect(await originalAnchor!.evaluate((element) => ({ connected: element.isConnected, focused: element.ownerDocument.activeElement === element })))
      .toEqual({ connected: true, focused: true });
    await expect(sourceLink).toBeFocused();
    const tabsBefore = await win.evaluate(async () => (await window.bullebrowser.tabs.list()).length);
    await sourceLink.press('Enter');
    await expect.poll(() => win.evaluate(async () => (await window.bullebrowser.tabs.list()).length)).toBe(tabsBefore + 1);
    await expectPage(app, win, `${site.url}/one`, 'Community funding source');
  } finally {
    await releasePageRead(app).catch(() => {});
    await close();
    await site.close();
  }
});

test('failed first navigation keeps the attempted address and can recover with Retry', async () => {
  const reserved = await fixture();
  const port = reserved.port;
  const url = `${reserved.url}/one`;
  await reserved.close();
  const { app, win, close } = await launch();
  let recovered: Awaited<ReturnType<typeof fixture>> | undefined;
  try {
    await enterAddress(win, url);
    await expect(win.getByRole('heading', { name: 'Page could not load', exact: true })).toBeVisible();
    await expect(win.getByRole('textbox', { name: 'Address bar', exact: true })).toHaveValue(url);
    expect((await pageState(app)).visible).toBe(false);
    await expect(win.getByRole('region', { name: 'BulleBrowser funding introduction' })).toBeHidden();
    recovered = await fixture(port);
    await win.getByRole('button', { name: 'Retry', exact: true }).click();
    await expectPage(app, win, url, 'Community funding source');
    await expect(win.getByRole('heading', { name: 'Page could not load', exact: true })).toBeHidden();
    await clickPage(app, '#page-action');
    await expect.poll(async () => (await pageState(app)).document.output).toBe('Page button clicked');
    await expectNativeBounds(app, win);
  } finally {
    await close();
    await recovered?.close();
  }
});


test('each browser option asks a short app question instead of filling the composer', async () => {
  const { win, close } = await launch();
  try {
    const tasks = [
      ['Find grants for me', 'Where are you based, and what needs funding?'],
      ['Research a funder', 'Which funder should I research?'],
      ['Compare grant opportunities', 'Which grants, or what funding goal, should I compare?'],
      ['Explore this page', 'What should I look for on this page?'],
    ];
    for (const [label, question] of tasks) {
      await win.getByRole('button', { name: label, exact: true }).click();
      await expect(win.getByRole('status').filter({ hasText: question })).toBeVisible();
      await expect(win.locator('aside textarea.prompt-input-field')).toHaveValue('');
      await expect(win.getByRole('region', { name: 'BulleBrowser funding introduction' })).toBeVisible();
    }
    // Composer motion is verified in the appearance suite, independently of task selection.
  } finally { await close(); }
});

test('follow-up retries remember the task without asking the user to repeat it', async () => {
  const site = await fixture();
  const { app, win, close } = await launch();
  try {
    await enterAddress(win, `${site.url}/one`);
    await expectPage(app, win, `${site.url}/one`, 'Community funding source');
    for (const [index, prompt] of ['Summarize this page', 'Try again', 'Continue'].entries()) {
      await win.locator('aside textarea.prompt-input-field').fill(prompt);
      await win.getByRole('button', { name: 'Send', exact: true }).click();
      const allow = win.getByRole('button', { name: 'Allow Access', exact: true });
      await expect(allow).toBeVisible();
      await allow.click();
      await expect(win.locator('.md-prose')).toHaveCount(index + 1);
      await expect(win.locator('.md-prose').last()).toContainText('Community funding source');
      await expect(win.locator('aside').getByRole('button', { name: 'Stop', exact: true })).toBeHidden();
    }
    const saved = await win.evaluate(async () => {
      const chats = await window.bullebrowser.conversations.list();
      return window.bullebrowser.conversations.get(chats[0]!.id);
    });
    expect(saved?.messages.filter((message) => message.role === 'user').map((message) => message.content))
      .toEqual(['Summarize this page', 'Try again', 'Continue']);
    expect(saved?.messages.filter((message) => message.role === 'assistant')).toHaveLength(3);
  } finally { await close(); await site.close(); }
});

for (const layout of ['classic', 'semantic', 'contents', 'delayed']) {
  test(`no search key uses visible browser search and filters \u0044uckDuckGo results (${layout})`, async () => {
    const source = await fixture();
    const { app, win, close } = await launch();
    try {
      await app.evaluate(({ session }, { base, layout }) => {
        process.env.BRAVE_SEARCH_API_KEY = '';
        const tracked = (url: string) => `https://www.bing.com/ck/a?u=a1${Buffer.from(url).toString('base64url')}&ntb=1`;
        // These layouts are Bing's. Startpage is tried first: send it on to Bing
        // so the agent falls back at once.
        session.defaultSession.protocol.handle('https', (request) => new URL(request.url).hostname === 'www.startpage.com' ? Response.redirect('https://www.bing.com/search?q=fallback', 302) : new Response(`<html><head>${layout === 'contents' ? '<style>h2 a { display: contents; }</style>' : ''}<title>Search results</title></head><body><a href="https://www.microsoft.com/">Not a search result</a><ol id="b_results"><li class="b_ad"><h2><a href="https://advertiser.example/">Sponsored funding</a></h2></li><li class="b_algo"><h2><a href="${tracked('https://\u0064uckduckgo.com/')}">Blocked</a></h2></li><li class="b_algo"><h2><a href="${tracked('https://www.instrumentl.com/grants')}">Grant search software</a></h2></li><li class="b_algo"><h2><a href="${tracked('https://grantable.co/')}">Grant writing service</a></h2></li><li class="b_algo"><h2><a href="${tracked(`${base}/one`)}">School grants program</a></h2></li><li class="b_algo"><h2><a href="${tracked(`${base}/two`)}">School grants application</a></h2></li></ol>${layout === 'delayed' ? `<script>const links = [...document.querySelectorAll('#b_results a')].map(a => ({a, href: a.href}));links.forEach(({a}) => a.href='https://www.bing.com/#pending');setTimeout(() => links.forEach(({a,href}) => a.href=href), 3500);</script>` : ''}</body></html>`.replaceAll('class="b_algo"', layout === 'semantic' ? 'class="result-card"' : 'class="b_algo"'), { headers: { 'Content-Type': 'text/html' } }));
      }, { base: source.url, layout });
      await win.locator('aside textarea.prompt-input-field').fill('Find grants for California schools');
      await win.getByRole('button', { name: 'Send', exact: true }).click();
      await win.getByRole('button', { name: 'Allow Access', exact: true }).click();
      await expect(win.locator('.md-prose')).toContainText('2 source pages', { timeout: 30000 });
      await expect(win.getByRole('button', { name: 'Configure web search', exact: true })).toHaveCount(0);
      await expect(win.getByRole('region', { name: 'Task activity' })).not.toContainText('untrusted_page_data');
      const tabs = await win.evaluate(() => window.bullebrowser.tabs.list());
      expect(tabs.some((tab) => /\u0064uckduckgo|duck\.com|ddg\.gg/.test(tab.url))).toBe(false);
      // Search exclusions contain vendor names in Bing's query string; only
      // a tab's destination hostname indicates the agent visited that vendor.
      expect(tabs.some((tab) => /(^|\.)(instrumentl\.com|grantable\.co)$/.test(new URL(tab.url).hostname))).toBe(false);
      expect(tabs.some((tab) => tab.url.startsWith('https://www.bing.com/search'))).toBe(true);
    } finally { await close(); await source.close(); }
  });

}

test('no search key searches Startpage first and reads its direct result links', async () => {
  const source = await fixture();
  const { app, win, close } = await launch();
  try {
    await app.evaluate(({ session }, { base }) => {
      process.env.BRAVE_SEARCH_API_KEY = '';
      session.defaultSession.protocol.handle('https', (request) => {
        const url = new URL(request.url);
        if (url.hostname !== 'www.startpage.com') return new Response('Unexpected search engine', { status: 404 });
        // Its home page has the search box the agent types into; Enter
        // submits to /sp/search, which only typing reaches.
        if (url.pathname === '/') return new Response('<html><head><title>Startpage</title></head><body><a href="/en/about">About</a><form action="/sp/search" method="get"><input id="q" name="query" type="text" aria-label="Search"></form></body></html>', { headers: { 'Content-Type': 'text/html' } });
        const result = (href: string, title: string) => `<div class="result"><a class="result-title result-link" href="${href}"><h2>${title}</h2></a></div>`;
        return new Response(`<html><head><title>Startpage Search Results</title></head><body><a href="https://www.startpage.com/en/privacy-policy/">Privacy</a><div class="ad-free-promo-card">Go Ad-Free</div><section id="main"><div id="gcsa-top" class="gcsa-container">Sponsored</div><div class="w-gl">${result('https://www.startpage.com/av/proxy?u=x', 'Anonymous view')}${result('https://grantable.co/', 'Grant writing service')}${result(`${base}/one`, 'School grants program')}${result(`${base}/two`, 'School grants application')}</div></section></body></html>`, { headers: { 'Content-Type': 'text/html' } });
      });
    }, { base: source.url });
    await win.evaluate(() => {
      const typed: string[] = [];
      (window as unknown as { __typed: string[] }).__typed = typed;
      window.bullebrowser.agent.onAddress(({ text }) => typed.push(text));
    });
    await win.locator('aside textarea.prompt-input-field').fill('Find grants for California schools');
    await win.getByRole('button', { name: 'Send', exact: true }).click();
    await win.getByRole('button', { name: 'Allow Access', exact: true }).click();
    await expect(win.locator('.md-prose')).toContainText('2 source pages', { timeout: 30000 });
    const tabs = await win.evaluate(() => window.bullebrowser.tabs.list());
    // The query was typed into the box and submitted, not loaded as a URL.
    expect(tabs.some((tab) => tab.url.startsWith('https://www.startpage.com/sp/search?query='))).toBe(true);
    // The address bar showed the agent typing where it went.
    const typed = await win.evaluate(() => (window as unknown as { __typed: string[] }).__typed);
    expect(typed).toContain('www.startpage.com');
    // Sources opened in new tabs are typed too.
    expect(typed).toContain(`${source.url.replace(/^https?:\/\//, '')}/one`);
    expect(tabs.some((tab) => /(^|\.)grantable\.co$/.test(new URL(tab.url).hostname))).toBe(false);
    // Startpage's ads and ad-free upsell are hidden; its results are not.
    const shown = await app.evaluate(async ({ webContents }) => {
      const page = webContents.getAllWebContents().find((wc) => wc.getURL().startsWith('https://www.startpage.com/sp/search'));
      return page?.executeJavaScript(`['#gcsa-top', '.ad-free-promo-card', '.w-gl .result'].map((s) => getComputedStyle(document.querySelector(s)).display)`);
    });
    expect(shown).toEqual(['none', 'none', expect.not.stringMatching(/^none$/)]);
  } finally { await close(); await source.close(); }
});

test('an AI account out of credit still browses, and the chat never mentions credit', async () => {
  const source = await fixture();
  // The API's real reply for an empty balance.
  let modelCalls = 0;
  const api = createServer((req, res) => {
    modelCalls += 1;
    req.resume();
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error',
      message: 'Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.' } }));
  });
  await new Promise<void>((done) => api.listen(0, '127.0.0.1', done));
  const apiUrl = `http://127.0.0.1:${(api.address() as { port: number }).port}`;
  const { app, win, close } = await launch();
  try {
    await app.evaluate(({ session }, { base, apiUrl }) => {
      process.env.BRAVE_SEARCH_API_KEY = '';
      process.env.ANTHROPIC_API_KEY = 'fixture-key-out-of-credit';
      process.env.ANTHROPIC_BASE_URL = apiUrl;
      session.defaultSession.protocol.handle('https', (request) => {
        const url = new URL(request.url);
        if (url.hostname !== 'www.startpage.com') return new Response('Unexpected search engine', { status: 404 });
        if (url.pathname === '/') return new Response('<html><head><title>Startpage</title></head><body><form action="/sp/search" method="get"><input id="q" name="query" type="text" aria-label="Search"></form></body></html>', { headers: { 'Content-Type': 'text/html' } });
        const result = (href: string, title: string) => `<div class="result"><a class="result-title result-link" href="${href}"><h2>${title}</h2></a></div>`;
        return new Response(`<html><head><title>Startpage Search Results</title></head><body><section id="main"><div class="w-gl">${result(`${base}/one`, 'School grants program')}${result(`${base}/two`, 'School grants application')}</div></section></body></html>`, { headers: { 'Content-Type': 'text/html' } });
      });
    }, { base: source.url, apiUrl });
    await win.locator('aside textarea.prompt-input-field').fill('Find grants for California schools');
    await win.getByRole('button', { name: 'Send', exact: true }).click();
    await win.getByRole('button', { name: 'Allow Access', exact: true }).click();
    await expect(win.locator('.md-prose')).toContainText('2 source pages', { timeout: 30000 });
    // The model really was asked, and refused for billing.
    expect(modelCalls).toBeGreaterThan(0);
    await expect(win.locator('aside')).not.toContainText(/credit|balance|billing/i);
    const tabs = await win.evaluate(() => window.bullebrowser.tabs.list());
    expect(tabs.some((tab) => tab.url.startsWith(`${source.url}/one`))).toBe(true);
  } finally { await close(); await source.close(); api.close(); }
});

test('an address entered with every tab closed opens in a new tab', async () => {
  const source = await fixture();
  const { win, close } = await launch();
  try {
    for (const tab of await win.evaluate(() => window.bullebrowser.tabs.list())) {
      await win.evaluate((id) => window.bullebrowser.tabs.close(id), tab.id);
    }
    await expect.poll(() => win.evaluate(async () => (await window.bullebrowser.tabs.list()).length)).toBe(0);
    const address = win.getByRole('textbox', { name: 'Address bar', exact: true });
    await address.fill(`${source.url}/one`);
    await address.press('Enter');
    await expect.poll(() => win.evaluate(async () => (await window.bullebrowser.tabs.list()).map((tab) => [tab.url, tab.active])))
      .toEqual([[`${source.url}/one`, true]]);
  } finally { await close(); await source.close(); }
});

test('conversation is answered in the chat without asking for browser access', async () => {
  const { win, close } = await launch();
  try {
    for (const [prompt, reply] of [['Hello!', "Hi! I'm BulleBrowser Agentic AI"], ['Thank you so much!', "You're welcome!"]] as const) {
      await win.locator('aside textarea.prompt-input-field').fill(prompt);
      await win.getByRole('button', { name: 'Send', exact: true }).click();
      await expect(win.locator('.md-prose').last()).toContainText(reply, { timeout: 15000 });
    }
    await expect(win.getByRole('button', { name: 'Allow Access', exact: true })).toHaveCount(0);
  } finally { await close(); }
});

test('History deletes every chat at once', async () => {
  const { win, close } = await launch();
  try {
    for (let i = 0; i < 3; i += 1) {
      await win.evaluate(async (n) => {
        const chat = await window.bullebrowser.conversations.create();
        await window.bullebrowser.conversations.setScratchpad(chat.id, `note ${n}`);
      }, i);
    }
    await win.locator('aside textarea.prompt-input-field').fill('Hello!');
    await win.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(win.locator('.md-prose').last()).toContainText("Hi! I'm", { timeout: 15000 });
    await win.getByRole('button', { name: 'History', exact: true }).click();
    win.once('dialog', (dialog) => { expect(dialog.message()).toMatch(/^Delete all \d+ chats\? This cannot be undone\.$/); void dialog.accept(); });
    await win.getByRole('button', { name: 'Delete all', exact: true }).click();
    // A fresh, empty chat takes their place.
    await expect.poll(() => win.evaluate(async () => (await window.bullebrowser.conversations.list()).filter((c) => c.messageCount > 0).length)).toBe(0);
    await expect(win.locator('.md-prose')).toHaveCount(0);
  } finally { await close(); }
});

test('offers to save a sign-in, then fills it from the key button on the same site only', async () => {
  const site = createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    if (req.method === 'POST') { req.resume(); res.end('<html><head><title>Welcome</title></head><body><h1>Signed in</h1></body></html>'); return; }
    res.end('<html><head><title>Sign in</title></head><body><form method="post" action="/welcome">' +
      '<input id="user" name="user" type="email"><input id="pass" name="pass" type="password">' +
      '<button type="submit">Sign in</button></form></body></html>');
  });
  await new Promise<void>((done) => site.listen(0, '127.0.0.1', done));
  const base = `http://127.0.0.1:${(site.address() as { port: number }).port}`;
  const { app, win, close } = await launch();
  // Saving needs the computer's secure credential storage; CI's Linux has none.
  const secure = await app.evaluate(({ safeStorage }) => safeStorage.isEncryptionAvailable()
    && (process.platform !== 'linux' || safeStorage.getSelectedStorageBackend() !== 'basic_text'));
  test.skip(!secure, 'No secure credential storage on this machine');
  const inPage = (script: string) => app.evaluate(({ webContents }, { base, script }) => {
    const page = webContents.getAllWebContents().find((wc) => wc.getURL().startsWith(base));
    return page?.executeJavaScript(script);
  }, { base, script });
  const openLogin = async () => {
    await win.evaluate(async (url) => {
      const tab = (await window.bullebrowser.tabs.list()).find((t) => t.active)!;
      await window.bullebrowser.tabs.navigate(tab.id, url);
    }, `${base}/login`);
    await expect.poll(() => inPage('document.title')).toBe('Sign in');
  };
  try {
    await openLogin();
    // No key before anything is saved.
    await expect(win.getByRole('button', { name: 'Fill saved password', exact: true })).toHaveCount(0);
    await inPage(`document.querySelector('#user').value = 'ana@org.org';
      document.querySelector('#pass').value = 'Sup3r-secret';
      document.querySelector('button').click();`);
    const offer = win.getByRole('group', { name: 'Save password', exact: true });
    await expect(offer).toContainText(`Save password for 127.0.0.1:${new URL(base).port} (ana@org.org)?`);
    await offer.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(offer).toHaveCount(0);

    await openLogin();
    const key = win.getByRole('button', { name: 'Fill saved password', exact: true });
    await expect(key).toBeVisible();
    await key.click();
    await expect.poll(() => inPage(`[document.querySelector('#user').value, document.querySelector('#pass').value]`))
      .toEqual(['ana@org.org', 'Sup3r-secret']);
    // "Show password" makes the field text; the agent's element list still hides it.
    const listed = await inPage(`document.querySelector('#pass').type = 'text'; ${PAGE_HELPERS}; __bb.FindElements('')`) as { lines: string[] };
    expect(listed.lines).toContain('@2 input[text] "pass" value="(hidden)"');
    expect(JSON.stringify(listed)).not.toContain('Sup3r-secret');
    await inPage(`document.querySelector('#pass').type = 'password'`);

    // The same sign-in is not offered again, and Settings lists it without the password.
    await inPage(`document.querySelector('button').click();`);
    await expect.poll(() => inPage('document.title')).toBe('Welcome');
    await expect(offer).toHaveCount(0);
    const saved = await win.evaluate(() => window.bullebrowser.passwords.list());
    expect(saved).toEqual([expect.objectContaining({ origin: base, username: 'ana@org.org' })]);
    expect(JSON.stringify(saved)).not.toContain('Sup3r-secret');
  } finally { await close(); site.close(); }
});

test('search-key settings are visible, masked and separate from model keys', async () => {
  const { win, close } = await launch();
  try {
    await win.getByRole('button', { name: 'Profile menu', exact: true }).click();
    await win.getByRole('button', { name: 'Settings', exact: true }).click();
    const section = win.getByRole('region', { name: 'Web search', exact: true });
    await expect(section).toContainText('Search key configured');
    await expect(section.getByLabel('Brave Search API key')).toHaveAttribute('type', 'password');
    await expect(section.getByLabel('Brave Search API key')).toHaveValue('');
    await expect(section.getByRole('button', { name: 'Save search key', exact: true })).toBeDisabled();
    await expect(section).not.toContainText('fixture-search-key-not-real');
  } finally { await close(); }
});

test('restricted destinations never send requests through navigation, redirects, popups or page resources', async () => {
  const receivedRestricted: string[] = [];
  const allowedPaths: string[] = [];
  let port = 0;
  const server = createServer((req, res) => {
    const host = req.headers.host ?? '';
    if (!host.startsWith('127.0.0.1:')) receivedRestricted.push(host);
    else allowedPaths.push(req.url ?? '/');
    if (req.url === '/redirect') {
      res.writeHead(302, { Location: `http://html.\u0064uckduckgo.com:${port}/redirected` });
      res.end();
      return;
    }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(`<!doctype html><html><head><title>Destination guard fixture</title></head><body><h1>Allowed source page</h1><p>This local source remains available.</p><a id="blocked-link" href="http://\u0064uckduckgo.com:${port}/clicked">Restricted link</a><a id="blocked-popup-link" target="_blank" href="http://\u0064uckduckgo.com:${port}/popup-link">Restricted popup</a><button id="blocked-popup-script" onclick="window.open('http://html.\u0064uckduckgo.com:${port}/popup-script'); history.replaceState({}, '', '#after-popup')">Open restricted popup</button><form action="http://duck.com:${port}/submitted"><input id="blocked-input" name="q" value="fixture"><button type="submit">Restricted form</button></form></body></html>`);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as { port: number }).port;
  const base = `http://127.0.0.1:${port}`;
  // A regression must never contact the actual prohibited service. These
  // names resolve only to this fixture, with proxies disabled for this test.
  const { app, win, close } = await launch([
    '--no-proxy-server',
    '--host-resolver-rules=MAP \u0064uckduckgo.com 127.0.0.1, MAP *.\u0064uckduckgo.com 127.0.0.1, MAP duck.com 127.0.0.1, MAP ddg.gg 127.0.0.1',
  ]);
  try {
    const pageErrors: string[] = [];
    win.on('pageerror', (error) => pageErrors.push(error.message));
    await app.evaluate(({ session }) => {
      const sent: string[] = [];
      (globalThis as Record<string, unknown>).__restrictedRequestProbe = sent;
      // Observe sends without replacing the production onBeforeRequest guard.
      session.defaultSession.webRequest.onSendHeaders({ urls: ['<all_urls>'] }, (details) => {
        sent.push(details.url);
      });
    });
    await enterAddress(win, `${base}/allowed`);
    await expectPage(app, win, `${base}/allowed`, 'Allowed source page');
    await app.evaluate(() => {
      const manager = (globalThis as unknown as { __bbTest: { tabManager: Hooks['tabManager'] & {
        setBrowsingActivity(runId: string, tabId: string): void;
      } } }).__bbTest.tabManager;
      manager.setBrowsingActivity('policy-recovery', manager.getActiveId());
    });
    const hasBrowsingCloud = () => app.evaluate(() => {
      const manager = (globalThis as unknown as { __bbTest: Hooks }).__bbTest.tabManager;
      return manager.getView(manager.getActiveId()).webContents.executeJavaScript("Boolean(document.getElementById('__bb_browsing_cloud__'))");
    });
    await expect.poll(hasBrowsingCloud).toBe(true);
    await enterAddress(win, `http://\u0064uckduckgo.com:${port}/typed`);
    await expect(win.getByRole('region', { name: 'Page loading error' })).toContainText('blocked by BulleBrowser policy');
    await app.evaluate(() => {
      const manager = (globalThis as unknown as { __bbTest: { tabManager: {
        clearBrowsingActivity(runId: string): void;
      } } }).__bbTest.tabManager;
      manager.clearBrowsingActivity('policy-recovery');
    });
    const captureFailure = await win.evaluate(async () => {
      try { await window.bullebrowser.agent.captureScreenshot(); return ''; }
      catch (error) { return (error as Error).message; }
    });
    expect(captureFailure).toContain('blocked by BulleBrowser policy');
    const recovery = win.getByRole('region', { name: 'Page loading error' }).getByRole('button', { name: 'Go back', exact: true });
    await expect(recovery).toBeEnabled();
    await recovery.click();
    await expectPage(app, win, `${base}/allowed`, 'Allowed source page');
    await expect.poll(hasBrowsingCloud).toBe(false);
    const outcomes = await app.evaluate(async ({ session }, fixturePort) => {
      const hooks = (globalThis as unknown as { __bbTest: {
        tabManager: Hooks['tabManager'] & {
          create(url: string): Promise<unknown>;
          navigate(id: string, url: string): Promise<void>;
          back(id: string): Promise<void>;
          getNavigationUrl(id: string): string | undefined;
          list(): Array<{ id: string }>;
        };
        runtime: Hooks['runtime'] & {
          navigate(id: string, url: string): Promise<unknown>;
          click(id: string, target: string): Promise<unknown>;
          pressKey(id: string, key: string): Promise<unknown>;
        };
      } }).__bbTest;
      const manager = hooks.tabManager;
      const id = manager.getActiveId();
      const wc = manager.getView(id).webContents;
      const refused: string[] = [];
      const policyFailures: Record<string, string | undefined> = {};
      const attempt = async (name: string, operation: () => Promise<unknown>) => {
        try { await operation(); }
        catch (error) {
          refused.push(name);
          policyFailures[name] = (error as { code?: string }).code;
        }
      };
      const root = `http://\u0064uckduckgo.com:${fixturePort}/direct`;
      await attempt('tab-create', () => manager.create(root));
      await attempt('tab-navigate', () => manager.navigate(id, root));
      await attempt('agent-navigate', () => hooks.runtime.navigate(id, root));
      // Exercise the native network guard even if an entry point bypasses
      // manager/runtime validation. Chromium load error wording varies by OS.
      await wc.loadURL(root).catch(() => {});
      await wc.loadURL(`http://127.0.0.1:${fixturePort}/allowed`);
      const pageResources = await wc.executeJavaScript(`Promise.all([
        new Promise(resolve => {
          const image = new Image();
          image.onload = () => resolve('image-loaded');
          image.onerror = () => resolve('image-blocked');
          image.src = 'http://duck.com:${fixturePort}/pixel';
          document.body.append(image);
        }),
        fetch('http://ddg.gg:${fixturePort}/fetch').then(() => 'fetch-loaded', () => 'fetch-blocked')
      ])`);
      const beforePopup = manager.list().length;
      await wc.executeJavaScript(`window.open('http://html.\u0064uckduckgo.com:${fixturePort}/popup'); true`);
      const afterPopup = manager.list().length;
      await hooks.runtime.navigate(id, `http://127.0.0.1:${fixturePort}/allowed`);
      await attempt('agent-popup-link', () => hooks.runtime.click(id, '#blocked-popup-link'));
      await hooks.runtime.navigate(id, `http://127.0.0.1:${fixturePort}/allowed`);
      const inPageUpdate = new Promise<void>((resolve) => wc.once('did-navigate-in-page', () => resolve()));
      await attempt('agent-popup-script', () => hooks.runtime.click(id, '#blocked-popup-script'));
      await inPageUpdate;
      await attempt('blocked-popup-read', () => hooks.runtime.readPage(id));
      await manager.back(id);
      const popupRecovery = {
        url: manager.getNavigationUrl(id), nativeUrl: wc.getURL(), visible: manager.getView(id).getVisible(),
      };
      const afterAgentPopups = manager.list().length;
      await hooks.runtime.navigate(id, `http://127.0.0.1:${fixturePort}/allowed`);
      await attempt('agent-click', () => hooks.runtime.click(id, '#blocked-link'));
      await hooks.runtime.navigate(id, `http://127.0.0.1:${fixturePort}/allowed`);
      await wc.executeJavaScript("document.querySelector('#blocked-input').focus()");
      await attempt('agent-enter', () => hooks.runtime.pressKey(id, 'Enter'));
      await hooks.runtime.navigate(id, `http://127.0.0.1:${fixturePort}/allowed`);
      await wc.loadURL(`http://127.0.0.1:${fixturePort}/redirect`).catch(() => {});
      const afterRedirect = wc.getURL();
      await attempt('blocked-redirect-read', () => hooks.runtime.readPage(id));
      // Future isolated browser sessions must receive the same network guard.
      const isolated = session.fromPartition('destination-guard-regression');
      await attempt('isolated-session', () => isolated.fetch(root));
      await hooks.runtime.navigate(id, `http://127.0.0.1:${fixturePort}/control`);
      return { refused, policyFailures, pageResources, beforePopup, afterPopup, afterAgentPopups, popupRecovery, afterRedirect };
    }, port);
    expect(outcomes.refused).toEqual(['tab-create', 'tab-navigate', 'agent-navigate', 'agent-popup-link', 'agent-popup-script', 'blocked-popup-read', 'agent-click', 'agent-enter', 'blocked-redirect-read', 'isolated-session']);
    expect(outcomes.policyFailures).toMatchObject({
      'agent-popup-link': 'BLOCKED_BY_POLICY', 'agent-popup-script': 'BLOCKED_BY_POLICY',
      'blocked-popup-read': 'BLOCKED_BY_POLICY',
      'agent-click': 'BLOCKED_BY_POLICY', 'agent-enter': 'BLOCKED_BY_POLICY', 'blocked-redirect-read': 'BLOCKED_BY_POLICY',
    });
    expect(outcomes.pageResources).toEqual(['image-blocked', 'fetch-blocked']);
    expect(outcomes.afterPopup).toBe(outcomes.beforePopup);
    expect(outcomes.afterAgentPopups).toBe(outcomes.beforePopup);
    expect(outcomes.popupRecovery).toEqual({
      url: `${base}/allowed#after-popup`, nativeUrl: `${base}/allowed#after-popup`, visible: true,
    });
    expect(outcomes.afterRedirect).not.toContain('\u0064uckduckgo.com');
    const sent = await app.evaluate(() => (globalThis as Record<string, unknown>).__restrictedRequestProbe as string[]);
    expect(sent.some((url) => url === `${base}/control`)).toBe(true);
    expect(sent.filter((url) => /\u0064uckduckgo|duck\.com|ddg\.gg/i.test(new URL(url).hostname))).toEqual([]);
    expect(allowedPaths).toContain('/redirect');
    expect(allowedPaths).toContain('/control');
    expect(receivedRestricted).toEqual([]);
    expect(pageErrors).toEqual([]);
    await expectPage(app, win, `${base}/control`, 'Allowed source page');
  } finally {
    await close();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test('settings and about stay above browsing and restore the page when closed', async () => {
  const source = await fixture();
  const { app, win, close } = await launch();
  try {
    await enterAddress(win, source.url + '/one');
    await expectPage(app, win, source.url + '/one', 'Community funding source');
    for (const title of ['Settings', 'About BulleBrowser']) {
      await win.getByRole('button', { name: 'Profile menu', exact: true }).click();
      await win.getByRole('button', { name: title, exact: true }).click();
      await expect(win.getByRole('dialog')).toBeVisible();
      await expect.poll(async () => (await pageState(app)).visible).toBe(false);
      await win.getByRole('button', { name: 'Close', exact: true }).click();
      await expect(win.getByRole('dialog')).toBeHidden();
      await expect.poll(async () => (await pageState(app)).visible).toBe(true);
    }
  } finally { await close(); await source.close(); }
});

test('a research prompt browses multiple real pages and shows live page counts', async () => {
  const server = createServer((req, res) => {
    res.setHeader('Content-Type', 'text/html');
    res.end(`<html><head><title>Grant research fixture</title></head><body><h1>Official grant source</h1><p>Program ${req.url}: school grants support accessible classrooms. Verify eligibility before applying.</p><a href="/program-1">Program one</a><a href="/program-2">Program two</a><a href="/program-3">Program three</a></body></html>`);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const { app, win, close } = await launch();
  try {
    await app.evaluate((_electron, fixtureUrl) => {
      const original = globalThis.fetch;
      globalThis.fetch = async (input, init) => {
        if (String(input).startsWith('https://api.search.brave.com/')) return new Response(JSON.stringify({ web: { results: [
          { title: 'Prohibited search result', url: 'https://\u0064uckduckgo.com/?q=school+grants' },
          ...[1, 2, 3].map((id) => ({ title: `Program ${id}`, url: `${fixtureUrl}/program-${id}` })),
        ] } }));
        return original(input, init);
      };
    }, base);
    await win.locator('aside textarea.prompt-input-field').fill('Find grants for California schools');
    await win.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(win.getByRole('button', { name: 'Allow Access', exact: true })).toBeVisible();
    await expect(win.getByRole('status', { name: 'Browser progress' })).toContainText('Waiting for browsing access');
    await win.getByRole('button', { name: 'Allow Access', exact: true }).click();
    const activity = win.getByRole('region', { name: 'Task activity' });
    await expect(activity).toBeVisible();
    await expect(activity.getByText(/pages? read/)).toBeVisible();
    await expect(win.locator('.md-prose')).toContainText('3 source pages', { timeout: 30_000 });
    await expect(activity.getByText('3 pages read', { exact: true })).toBeVisible();
    await activity.getByRole('button', { name: 'Toggle task activity', exact: true }).click();
    await expect(activity.getByRole('log')).toContainText('Reading the page');
    await expect(activity.getByRole('log')).not.toContainText('\u0064uckduckgo.com');
    await expect.poll(async () => (await pageState(app)).url).toBe(base + '/program-1');
    expect((await win.evaluate(() => window.bullebrowser.tabs.list())).filter((tab) => tab.url.includes('/program-'))).toHaveLength(3);
    await expect(win.locator('.md-prose')).not.toContainText('Official grant source');
    await win.screenshot({ path: '/tmp/bullebrowser-research-progress.png' });
  } finally {
    await close();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

for (const option of [
  { label: 'Find grants for me', answer: 'California schools need accessibility funding' },
  { label: 'Research a funder', answer: 'Community Foundation education programs' },
  { label: 'Compare grant opportunities', answer: 'Accessible classrooms in California schools' },
  { label: 'Explore this page', answer: 'Find the eligibility and application requirements' },
]) {
  test(`${option.label} asks once then shows real progress and reads visible source tabs`, async () => {
    const server = createServer((req, res) => {
      res.setHeader('Content-Type', 'text/html');
      res.end(`<html><head><title>Education funding options</title></head><body><h1>School grant programs</h1><p style="margin-bottom:900px">${req.url}: grants support accessible classrooms.</p><h2>Eligibility and application requirements</h2><p>Schools can request funding. Check program criteria.</p><a href="/program-1">Education grant one</a><a href="/program-2">Education grant two</a><a href="/program-3">Education grant three</a></body></html>`);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    const { app, win, close } = await launch();
    try {
      await enterAddress(win, base);
      await expectPage(app, win, base + '/', 'School grant programs');
      await app.evaluate((_electron, fixtureUrl) => {
        const original = globalThis.fetch;
        globalThis.fetch = async (input, init) => {
          if (String(input).startsWith('https://api.search.brave.com/')) return new Response(JSON.stringify({ web: { results: [1, 2, 3].map((id) => ({ title: `Program ${id}`, url: `${fixtureUrl}/program-${id}` })) } }));
          return original(input, init);
        };
      }, base);
      await win.getByRole('button', { name: option.label, exact: true }).click();
      await expect(win.locator('aside textarea.prompt-input-field')).toHaveValue('');
      await win.locator('aside textarea.prompt-input-field').fill(option.answer);
      await holdActualPageRead(app, true);
      await win.getByRole('button', { name: 'Send', exact: true }).click();
      await expect(win.getByRole('button', { name: 'Allow Access', exact: true })).toBeVisible();
      await win.getByRole('button', { name: 'Allow Access', exact: true }).click();
      await expect.poll(() => app.evaluate(async () => {
        const manager = (globalThis as unknown as { __bbTest: Hooks }).__bbTest.tabManager;
        return manager.getView(manager.getActiveId()).webContents.executeJavaScript("Boolean(document.getElementById('__bb_agent_cursor__')?.shadowRoot?.querySelector('.ptr'))");
      })).toBe(true);
      await expect.poll(() => app.evaluate(() => (globalThis as unknown as { __browsingRead: ReadProbe }).__browsingRead.entered)).toBe(1);
      await expect(win.getByRole('status', { name: 'Browser progress' })).toBeVisible();
      await releasePageRead(app);
      await expect(win.locator('.md-prose')).toContainText('3 source pages', { timeout: 30_000 });
      const tabs = await win.evaluate(() => window.bullebrowser.tabs.list());
      expect(tabs.filter((tab) => tab.url.includes('/program-'))).toHaveLength(3);
      expect(tabs.find((tab) => tab.active)?.url).toBe(base + '/program-1');
      await expect(win.locator('.md-prose')).not.toContainText('grants support accessible classrooms');
    } finally {
      await close();
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });
}

test('Find grants for me finishes in the browser after unreadable assistant replies', async () => {
  const pages = await fixture();
  const { app, win, close } = await launch([], true);
  try {
    await app.evaluate((_electron, base) => {
      const original = globalThis.fetch;
      const state = globalThis as unknown as { brokenReplies: number };
      state.brokenReplies = 0;
      globalThis.fetch = async (input, init) => {
        if (String(input).startsWith('https://api.openai.com/v1/chat/completions')) {
          const body = JSON.parse(String(init?.body));
          if (!body.stream) {
            return Response.json({ choices: [{ finish_reason: 'stop', message: { content: '["Find sources","Check eligibility"]' } }] });
          }
          state.brokenReplies++;
          return new Response('data: {"choices":\n\n', { headers: { 'content-type': 'text/event-stream' } });
        }
        if (String(input).startsWith('https://api.search.brave.com/')) {
          return Response.json({ web: { results: [1, 2, 3].map((id) => ({ title: `School grant ${id}`, url: `${base}/program-${id}` })) } });
        }
        return original(input, init);
      };
    }, pages.url);
    await win.evaluate(() => window.bullebrowser.settings.set({ defaultModel: 'gpt-4o' }));
    await win.reload();
    const panel = win.getByRole('complementary', { name: 'Assistant chat' });
    await panel.getByRole('button', { name: 'Find grants for me', exact: true }).click();
    await panel.locator('textarea.prompt-input-field').fill('Seattle schools need accessibility funding');
    await panel.getByRole('button', { name: 'Send', exact: true }).click();
    await win.getByRole('button', { name: 'Allow Access', exact: true }).click();
    await expect(panel.locator('.md-prose')).toContainText('3 source pages', { timeout: 45_000 });
    await expect(panel).not.toContainText(/unexpected end|not valid JSON|task could not finish/i);
    const tabs = await win.evaluate(() => window.bullebrowser.tabs.list());
    expect(tabs.filter((tab) => tab.url.startsWith(pages.url + '/program-'))).toHaveLength(3);
    expect(tabs.find((tab) => tab.active)?.url).toBe(pages.url + '/program-1');
    expect(await app.evaluate(() => (globalThis as unknown as { brokenReplies: number }).brokenReplies)).toBe(3);
  } finally {
    await close();
    await pages.close();
  }
});

// Opt-in provider smoke test; deterministic layout coverage above runs in CI.
test('live Bing search discovers and reads Seattle funding sources', async () => {
  test.skip(process.env.BULLEBROWSER_LIVE_SEARCH !== '1', 'Requires a live search provider');
  test.setTimeout(120_000);
  const { app, win, close } = await launch();
  try {
    await app.evaluate(() => { process.env.BRAVE_SEARCH_API_KEY = ''; });
    await win.locator('aside textarea.prompt-input-field').fill('Find open grants funding Seattle');
    await win.getByRole('button', { name: 'Send', exact: true }).click();
    await win.getByRole('button', { name: 'Allow Access', exact: true }).click();
    await expect(win.locator('.md-prose')).toContainText('source pages', { timeout: 90_000 });
    await expect(win.locator('.md-prose')).not.toContainText('could not finish');
    const tabs = await win.evaluate(() => window.bullebrowser.tabs.list());
    console.log('Live search report:', await win.locator('.md-prose').innerText(), tabs.map((tab) => ({ url: tab.url, title: tab.title })));
    expect(tabs.some((tab) => /(^|\.)(seattle\.gov|seattlefoundation\.org|kingcounty\.gov)$/.test(new URL(tab.url).hostname))).toBe(true);
  } finally { await close(); }
});
