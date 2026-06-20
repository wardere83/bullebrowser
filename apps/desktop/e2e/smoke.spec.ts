import { test, expect, _electron as electron } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(here, '..');

async function launch() {
  // Fresh user-data dir per test so we always start with no API key and
  // default settings — required for the validation + API-key-prompt assertions.
  const userData = mkdtempSync(join(tmpdir(), 'bullebrowser-e2e-'));
  const app = await electron.launch({
    args: ['.', '--no-sandbox', `--user-data-dir=${userData}`],
    cwd: appRoot,
    env: { ...process.env, NODE_ENV: 'test' },
  });
  const win = await app.firstWindow({ timeout: 20_000 });
  await win.waitForLoadState('domcontentloaded');
  // Default settings now ship with aiPanelOpen: true (the BulleBrowser
  // rebrand made the agent the front-and-center surface). Open the
  // panel idempotently so this works whether the boot lands open or
  // closed.
  const aside = win.locator('aside');
  if (!(await aside.isVisible().catch(() => false))) {
    await win.getByRole('button', { name: 'AI' }).click();
  }
  await win.waitForSelector('aside', { timeout: 10_000 });
  return { app, win };
}

test('AI agent panel mounts after toggling open', async () => {
  const { app, win } = await launch();
  await expect(win.locator('aside').getByText('AI agent')).toBeVisible();
  await app.close();
});

test('fresh profile shows the API-key prompt and disables the textarea', async () => {
  const { app, win } = await launch();
  await expect(win.getByText('Add your Anthropic API key')).toBeVisible();
  await expect(win.locator('aside textarea')).toBeDisabled();
  await app.close();
});

test('API key validation rejects malformed keys with a visible error', async () => {
  const { app, win } = await launch();
  await win.getByRole('button', { name: 'Open Settings' }).click();
  const keyInput = win.locator('input[type="password"]');
  await keyInput.fill('totally-bogus-key');
  await win.getByRole('button', { name: 'Save' }).click();
  await expect(
    win.getByText(/doesn't look like an Anthropic API key/i),
  ).toBeVisible({ timeout: 5_000 });
  await app.close();
});
