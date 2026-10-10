import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test';
import { createServer } from 'node:http';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cloudId = '__bb_browsing_cloud__';

type Hooks = {
  tabManager: {
    getActiveId(): string;
    getView(id: string): { webContents: Electron.WebContents };
    setBrowsingActivity(runId: string, tabId: string): void;
    clearBrowsingActivity(runId: string): void;
  };
  runtime: {
    readPage(tabId: string): Promise<unknown>;
    screenshot(tabId: string): Promise<{ pngBase64: string }>;
  };
};

async function launch() {
  const env = {
    ...process.env,
    NODE_ENV: 'test',
    BULLEBROWSER_TEST_HOOKS: '1',
    ANTHROPIC_API_KEY: '',
    OPENAI_API_KEY: '',
  };
  delete (env as NodeJS.ProcessEnv).ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({
    cwd: appRoot,
    args: ['.', '--no-sandbox', `--user-data-dir=${mkdtempSync(join(tmpdir(), 'bullebrowser-appearance-'))}`],
    env,
  });
  const win = await app.firstWindow({ timeout: 20_000 });
  await win.waitForLoadState('domcontentloaded');
  await expect(win.getByRole('complementary', { name: 'Assistant chat' })).toBeVisible();
  await expect.poll(() => app.evaluate(() => Boolean((globalThis as Record<string, unknown>).__bbTest))).toBe(true);
  // The panel shell appears before settings and the first conversation finish
  // loading. Its empty-chat view confirms the session exists before tests seed
  // history or send a task.
  await expect(win.getByRole('heading', { name: 'What can I help you with?', exact: true })).toBeVisible();
  return { app, win };
}

async function fixture() {
  const server = createServer((req, res) => {
    if (req.url === '/page.css') {
      res.setHeader('Content-Type', 'text/css');
      res.end('body{margin:0;background:#f9fafb;color:#182436;font:18px system-ui}main{padding:36px;min-height:2200px}button{padding:18px;margin:12px 0}');
      return;
    }
    if (req.url === '/page.js') {
      res.setHeader('Content-Type', 'application/javascript');
      res.end(`window.cspViolations=[];document.addEventListener('securitypolicyviolation',e=>window.cspViolations.push(e.violatedDirective));document.querySelector('button').addEventListener('click',()=>document.querySelector('output').textContent='Clicked');`);
      return;
    }
    res.setHeader('Content-Type', 'text/html');
    res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'");
    res.end('<!doctype html><html><head><title>Grant deadlines</title><link rel="stylesheet" href="/page.css"><script defer src="/page.js"></script></head><body><main><h1>Grant deadlines</h1><p>Grant applications close on December 15. Eligible schools can request funding for accessible classrooms.</p><button>Page interaction</button><output>Ready</output></main></body></html>');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as { port: number };
  return { url: `http://127.0.0.1:${port}/`, close: () => new Promise<void>((resolve) => server.close(() => resolve())) };
}

async function readPage<T>(app: ElectronApplication, tabId: string, script: string): Promise<T> {
  return app.evaluate(async (_electron, { id, source }) => {
    const hooks = (globalThis as unknown as { __bbTest: Hooks }).__bbTest;
    return hooks.tabManager.getView(id).webContents.executeJavaScript(source);
  }, { id: tabId, source: script });
}

const cloudProbe = `(()=>{const host=document.getElementById('${cloudId}');if(!host)return null;const css=getComputedStyle(host);return {position:css.position,pointerEvents:css.pointerEvents,animation:css.animationName,inert:host.inert,hidden:host.getAttribute('aria-hidden'),closedShadow:host.shadowRoot===null,count:document.querySelectorAll('#${cloudId}').length};})()`;

async function holdReads(app: ElectronApplication) {
  await app.evaluate(() => {
    const runtime = (globalThis as unknown as { __bbTest: Hooks }).__bbTest.runtime;
    const proto = Object.getPrototypeOf(runtime);
    const original = proto.readPage;
    const probe = { entered: 0, release: null as null | (() => void) };
    (globalThis as Record<string, unknown>).__appearanceRead = probe;
    proto.readPage = async function (tabId: string) {
      // Read the actual page before pausing; the real task, consent, runtime,
      // storage and cancellation path continue to run normally.
      const result = await original.call(this, tabId);
      probe.entered += 1;
      await new Promise<void>((resolve) => { probe.release = resolve; });
      return result;
    };
  });
}

async function releaseRead(app: ElectronApplication) {
  await app.evaluate(() => {
    const probe = (globalThis as unknown as { __appearanceRead: { release: null | (() => void) } }).__appearanceRead;
    probe.release?.();
    probe.release = null;
  });
}

test('dark chat keeps the composer, Markdown, history and attachment menu readable', async () => {
  const { app, win } = await launch();
  try {
    const seed = await win.evaluate(async () => {
      const list = await window.bullebrowser.conversations.list();
      return window.bullebrowser.conversations.get(list[0]!.id);
    });
    await app.evaluate(({ ipcMain }, conversation) => {
      conversation!.title = 'Dark appearance fixture';
      conversation!.messages = [
        { role: 'user', content: 'Summarize this page', timestamp: Date.now() },
        { role: 'assistant', content: '## Research summary\n\nThe deadline is **December 15**. See the [source](https://example.com).\n\nUse `local mode` without a key.\n\n```text\nApplications are open.\n```\n\n| Item | Detail |\n| --- | --- |\n| Funding | Accessible classrooms |\n\n> The page remains yours to control.', timestamp: Date.now() },
      ];
      ipcMain.removeHandler('conversation:get');
      ipcMain.handle('conversation:get', () => conversation);
      ipcMain.removeHandler('conversation:list');
      ipcMain.handle('conversation:list', () => [{
        id: conversation!.id, title: conversation!.title,
        createdAt: conversation!.createdAt, updatedAt: conversation!.updatedAt,
        messageCount: conversation!.messages.length,
      }]);
    }, seed);
    await win.reload();
    // Relaunch deliberately opens a fresh chat; open the saved fixture through
    // the same history control a user uses to resume a conversation.
    await win.getByRole('button', { name: 'History', exact: true }).click();
    await win.getByRole('button', { name: /Dark appearance fixture/ }).click();
    await expect(win.getByRole('heading', { name: 'Research summary' })).toBeVisible();
    await win.locator('aside textarea').fill('A readable draft');
    const styles = await win.evaluate(() => {
      const selectors = ['aside', 'aside .prompt-input-shell', 'aside textarea', '.chat-user-message', '.md-prose', '.md-prose a', '.md-prose code', '.md-prose pre', '.md-prose th', '.md-prose blockquote'];
      const rgb = (value: string) => value.match(/[\d.]+/g)!.map(Number);
      const luminance = (value: number[]) => value.slice(0, 3).map((v) => v / 255).map((v) => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4).reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i]!, 0);
      return selectors.map((selector) => {
        const element = document.querySelector(selector)!;
        const css = getComputedStyle(element);
        let ancestor: Element | null = element;
        let background = rgb(css.backgroundColor);
        while (background[3] === 0 && ancestor?.parentElement) {
          ancestor = ancestor.parentElement;
          background = rgb(getComputedStyle(ancestor).backgroundColor);
        }
        const foreground = luminance(rgb(css.color));
        const back = luminance(background);
        return { selector, background: background.slice(0, 3), contrast: (Math.max(foreground, back) + 0.05) / (Math.min(foreground, back) + 0.05) };
      });
    });
    for (const style of styles) {
      expect(Math.max(...style.background), style.selector).toBeLessThan(100);
      expect(style.contrast, style.selector).toBeGreaterThanOrEqual(4.5);
    }
    await win.getByRole('button', { name: 'History', exact: true }).click();
    await expect(win.getByText('Chat history', { exact: true })).toBeVisible();
    expect(await win.getByText('Chat history', { exact: true }).evaluate((element) => getComputedStyle(element.parentElement!.parentElement!).backgroundColor)).not.toBe('rgb(255, 255, 255)');
    await win.getByRole('button', { name: 'Close', exact: true }).click();
    await win.getByRole('button', { name: 'Add attachment', exact: true }).click();
    const upload = win.getByRole('button', { name: /Upload your file/ });
    await expect(upload).toBeVisible();
    expect(await upload.evaluate((element) => getComputedStyle(element.parentElement!).backgroundColor)).not.toBe('rgb(255, 255, 255)');
    await win.locator('aside header').click();
    await win.screenshot({ path: join(tmpdir(), 'bullebrowser-dark-chat.png') });
  } finally { await app.close(); }
});

test('the browsing cloud follows real keyless consent, completion and Stop without blocking the page', async () => {
  const site = await fixture();
  const { app, win } = await launch();
  try {
    const tabId = await win.evaluate(async (url) => {
      const active = (await window.bullebrowser.tabs.list()).find((tab) => tab.active)!;
      await window.bullebrowser.tabs.navigate(active.id, url);
      return active.id;
    }, site.url);
    await holdReads(app);
    const begin = async () => {
      await win.locator('aside textarea').fill('summarize this page');
      await win.getByRole('button', { name: 'Send', exact: true }).click();
      await expect(win.getByRole('button', { name: 'Allow Access', exact: true })).toBeVisible();
      expect(await readPage(app, tabId, cloudProbe)).toBeNull();
      await win.getByRole('button', { name: 'Allow Access', exact: true }).click();
      await expect.poll(() => readPage(app, tabId, cloudProbe)).toMatchObject({ position: 'fixed', pointerEvents: 'none', inert: true, hidden: 'true', closedShadow: true, count: 1 });
    };
    await begin();
    await expect.poll(() => app.evaluate(() => (globalThis as unknown as { __appearanceRead: { entered: number } }).__appearanceRead.entered)).toBe(1);
    const png = await app.evaluate(async (_electron, id) => {
      const wc = (globalThis as unknown as { __bbTest: Hooks }).__bbTest.tabManager.getView(id).webContents;
      return (await wc.capturePage()).toPNG().toString('base64');
    }, tabId);
    writeFileSync(join(tmpdir(), 'bullebrowser-browsing-cloud.png'), Buffer.from(png, 'base64'));
    // Native mouse input hits the webpage through the decorative cloud.
    await app.evaluate(async (_electron, id) => {
      const wc = (globalThis as unknown as { __bbTest: Hooks }).__bbTest.tabManager.getView(id).webContents;
      const point = await wc.executeJavaScript("(()=>{const r=document.querySelector('button').getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};})()");
      wc.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...point });
      wc.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...point });
    }, tabId);
    await expect.poll(() => readPage(app, tabId, "document.querySelector('output').textContent")).toBe('Clicked');
    await app.evaluate((_electron, id) => {
      const wc = (globalThis as unknown as { __bbTest: Hooks }).__bbTest.tabManager.getView(id).webContents;
      wc.sendInputEvent({ type: 'mouseWheel', x: 200, y: 300, deltaY: -500, canScroll: true });
    }, tabId);
    await expect.poll(() => readPage<number>(app, tabId, 'window.scrollY')).toBeGreaterThan(0);
    expect(await readPage(app, tabId, 'window.cspViolations')).toEqual([]);
    await releaseRead(app);
    await expect(win.locator('.md-prose').getByText(/Grant applications close on December 15/)).toBeVisible();
    await expect.poll(() => readPage(app, tabId, cloudProbe)).toBeNull();
    const stop = win.locator('aside').getByRole('button', { name: 'Stop', exact: true });
    await expect(stop).toBeHidden();
    await begin();
    await expect.poll(() => app.evaluate(() => (globalThis as unknown as { __appearanceRead: { entered: number } }).__appearanceRead.entered)).toBe(2);
    await stop.click();
    // Stop clears the cloud before the unresolved page read can finish.
    await expect.poll(() => readPage(app, tabId, cloudProbe)).toBeNull();
    await releaseRead(app);
    await expect(stop).toBeHidden();
    expect(await readPage(app, tabId, cloudProbe)).toBeNull();
    await expect(win.locator('.md-prose')).toHaveCount(1);
  } finally {
    await releaseRead(app).catch(() => {});
    await app.close();
    await site.close();
  }
});

test('the cloud stays with its active tab, survives navigation, and respects reduced motion and run ownership', async () => {
  const site = await fixture();
  const { app, win } = await launch();
  try {
    const first = await win.evaluate(async (url) => {
      const active = (await window.bullebrowser.tabs.list()).find((tab) => tab.active)!;
      await window.bullebrowser.tabs.navigate(active.id, url);
      return active.id;
    }, site.url);
    await app.evaluate((_electron, id) => (globalThis as unknown as { __bbTest: Hooks }).__bbTest.tabManager.setBrowsingActivity('first-run', id), first);
    await expect.poll(() => readPage(app, first, cloudProbe)).not.toBeNull();
    const second = await win.evaluate((url) => window.bullebrowser.tabs.create(url), `${site.url}?second`);
    await expect.poll(() => readPage(app, first, cloudProbe)).toBeNull();
    await expect.poll(() => readPage(app, second.id, cloudProbe)).toBeNull();
    await win.evaluate((id) => window.bullebrowser.tabs.switch(id), first);
    await expect.poll(() => readPage(app, first, cloudProbe)).not.toBeNull();
    await win.evaluate(({ id, url }) => window.bullebrowser.tabs.navigate(id, url), { id: first, url: `${site.url}?navigated` });
    await expect.poll(() => readPage(app, first, cloudProbe)).toMatchObject({ count: 1, position: 'fixed' });
    await app.evaluate(async (_electron, id) => {
      const wc = (globalThis as unknown as { __bbTest: Hooks }).__bbTest.tabManager.getView(id).webContents;
      wc.debugger.attach('1.3');
      await wc.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    }, first);
    await expect.poll(() => readPage(app, first, cloudProbe)).toMatchObject({ animation: 'none' });
    await app.evaluate((_electron, id) => {
      const manager = (globalThis as unknown as { __bbTest: Hooks }).__bbTest.tabManager;
      manager.setBrowsingActivity('newer-run', id);
      manager.clearBrowsingActivity('first-run');
    }, first);
    await expect.poll(() => readPage(app, first, cloudProbe)).toMatchObject({ count: 1 });
    await app.evaluate(() => (globalThis as unknown as { __bbTest: Hooks }).__bbTest.tabManager.clearBrowsingActivity('newer-run'));
    await expect.poll(() => readPage(app, first, cloudProbe)).toBeNull();
    await app.evaluate((_electron, id) => (globalThis as unknown as { __bbTest: Hooks }).__bbTest.tabManager.getView(id).webContents.debugger.detach(), first);
  } finally {
    await app.close();
    await site.close();
  }
});

test('page screenshots stay clear across navigation, overlapping captures and cancellation', async () => {
  const site = await fixture();
  const { app, win } = await launch();
  try {
    const first = await win.evaluate(async (url) => {
      const active = (await window.bullebrowser.tabs.list()).find((tab) => tab.active)!;
      await window.bullebrowser.tabs.navigate(active.id, url);
      return active.id;
    }, site.url);
    await app.evaluate((_electron, id) => {
      const hooks = (globalThis as unknown as { __bbTest: Hooks }).__bbTest;
      hooks.tabManager.setBrowsingActivity('capture-run', id);
      const wc = hooks.tabManager.getView(id).webContents;
      const original = wc.capturePage.bind(wc);
      const probe = {
        releases: [] as (() => void)[],
        captures: [] as Promise<{ pngBase64: string }>[],
        completed: 0,
      };
      (globalThis as Record<string, unknown>).__appearanceCapture = probe;
      wc.capturePage = async (...args: Parameters<typeof original>) => {
        await new Promise<void>((resolve) => probe.releases.push(resolve));
        return original(...args);
      };
    }, first);
    await expect.poll(() => readPage(app, first, cloudProbe)).not.toBeNull();
    const startCapture = () => app.evaluate((_electron, id) => {
      const hooks = (globalThis as unknown as { __bbTest: Hooks }).__bbTest;
      const probe = (globalThis as unknown as {
        __appearanceCapture: { captures: Promise<{ pngBase64: string }>[], completed: number };
      }).__appearanceCapture;
      probe.captures.push(hooks.runtime.screenshot(id).then((result) => {
        probe.completed += 1;
        return result;
      }));
    }, first);
    const entered = () => app.evaluate(() => (globalThis as unknown as {
      __appearanceCapture: { releases: (() => void)[] };
    }).__appearanceCapture.releases.length);
    const release = (index: number) => app.evaluate((_electron, i) => {
      (globalThis as unknown as { __appearanceCapture: { releases: (() => void)[] } }).__appearanceCapture.releases[i]!();
    }, index);
    await startCapture();
    await expect.poll(entered).toBe(1);
    await expect.poll(() => readPage(app, first, cloudProbe)).toBeNull();
    await win.evaluate(({ id, url }) => window.bullebrowser.tabs.navigate(id, url), { id: first, url: `${site.url}?capture` });
    expect(await readPage(app, first, cloudProbe)).toBeNull();
    await win.evaluate((url) => window.bullebrowser.tabs.create(url), `${site.url}?other`);
    await win.evaluate((id) => window.bullebrowser.tabs.switch(id), first);
    expect(await readPage(app, first, cloudProbe)).toBeNull();
    // The composer's real IPC capture shares suppression with the model tool.
    await win.evaluate(() => {
      (window as unknown as Record<string, unknown>).__appearanceAttachment = window.bullebrowser.agent.captureScreenshot();
    });
    await expect.poll(entered).toBe(2);
    await release(0);
    await expect.poll(() => app.evaluate(() => (globalThis as unknown as {
      __appearanceCapture: { completed: number };
    }).__appearanceCapture.completed)).toBe(1);
    expect(await readPage(app, first, cloudProbe)).toBeNull();
    await release(1);
    expect(await win.evaluate(async () => {
      const result = await (window as unknown as {
        __appearanceAttachment: Promise<{ pngBase64: string } | null>;
      }).__appearanceAttachment;
      return (result?.pngBase64.length ?? 0) > 0;
    })).toBe(true);
    await expect.poll(() => readPage(app, first, cloudProbe)).toMatchObject({ count: 1 });
    await startCapture();
    await expect.poll(entered).toBe(3);
    await app.evaluate(() => (globalThis as unknown as { __bbTest: Hooks }).__bbTest.tabManager.clearBrowsingActivity('capture-run'));
    await release(2);
    await expect.poll(() => app.evaluate(() => (globalThis as unknown as {
      __appearanceCapture: { completed: number };
    }).__appearanceCapture.completed)).toBe(2);
    expect(await readPage(app, first, cloudProbe)).toBeNull();
  } finally {
    await app.evaluate(() => {
      const probe = (globalThis as unknown as { __appearanceCapture?: { releases: (() => void)[] } }).__appearanceCapture;
      probe?.releases.forEach((release) => release());
    }).catch(() => {});
    await app.close();
    await site.close();
  }
});
