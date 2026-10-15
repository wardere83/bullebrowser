import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { launchApp, removeUserData } from './funding-harness.js';

test('blank tabs show the funding video intro and webpages keep the browsing area', async () => {
  const server = createServer((_request, response) => {
    response.setHeader('Content-Type', 'text/html');
    response.end('<!doctype html><title>Browsing area check</title><h1>This is the browsed page</h1>');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('No browser test port');
  const url = `http://127.0.0.1:${address.port}/`;
  const { app, win, workspace, panel, userData } = await launchApp({ openFunding: false });
  try {
    await expect(panel).toBeVisible();
    await expect(workspace).toBeHidden();
    const intro = win.getByRole('region', { name: 'BulleBrowser funding introduction' });
    await expect(intro).toBeVisible();
    await expect(intro).toContainText('businesses and CBOs');
    await win.emulateMedia({ reducedMotion: 'no-preference' });
    const film = intro.locator('video');
    await expect.poll(() => film.evaluate((element: HTMLVideoElement) => ({
      loaded: element.readyState >= 2,
      width: element.videoWidth,
      muted: element.muted,
      playing: !element.paused,
    }))).toEqual({ loaded: true, width: 1920, muted: true, playing: true });
    await intro.getByRole('button', { name: 'Pause intro video', exact: true }).click();
    await expect.poll(() => film.evaluate((element: HTMLVideoElement) => element.paused)).toBe(true);
    await intro.getByRole('button', { name: 'Play intro video', exact: true }).click();
    await expect.poll(() => film.evaluate((element: HTMLVideoElement) => element.paused)).toBe(false);
    await win.emulateMedia({ reducedMotion: 'reduce' });
    await expect.poll(() => film.evaluate((element: HTMLVideoElement) => element.paused)).toBe(true);
    await expect(panel.locator('header')).not.toContainText('BulleBrowser Agentic AI');
    await expect(panel.getByRole('button', { name: 'History', exact: true })).toBeVisible();
    await expect(panel.getByRole('button', { name: 'New chat', exact: true })).toBeVisible();
    await expect(win.getByRole('button', { name: 'Organization Knowledge Hub', exact: true })).toHaveCount(0);
    await expect(win.getByRole('button', { name: 'Dashboard', exact: true })).toHaveCount(0);
    await win.evaluate(async () => { await window.bullebrowser.tabs.create(); });
    await expect(workspace).toBeHidden();
    await expect(intro).toBeVisible();
    await win.evaluate(async (url) => { await window.bullebrowser.tabs.create(url); }, url);
    await expect.poll(() => app.evaluate(async ({ BrowserWindow }, url) => {
      const page = BrowserWindow.getAllWindows()[0]?.contentView.children.find((view) =>
        'webContents' in view && (view as import('electron').WebContentsView).webContents.getURL() === url,
      ) as import('electron').WebContentsView | undefined;
      if (!page) return null;
      return {
        title: await page.webContents.executeJavaScript('document.title'),
        visible: page.getVisible(),
        fillsPageSlot: page.getBounds().width > 300 && page.getBounds().height > 300,
      };
    }, url)).toMatchObject({ title: 'Browsing area check', visible: true, fillsPageSlot: true });
    await expect(workspace).toBeHidden();
    await expect(intro).toHaveCount(0);
    await win.screenshot({ path: '/tmp/bulle-browser-layout.png' });
  } finally {
    await app.close();
    removeUserData(userData);
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
