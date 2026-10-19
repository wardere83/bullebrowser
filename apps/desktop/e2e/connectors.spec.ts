import { test, expect, _electron as electron } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('search, explicitly enable, persist and revoke a custom browser connector', async () => {
  const userData = mkdtempSync(join(tmpdir(), 'bullebrowser-connectors-'));
  const env = { ...process.env, NODE_ENV: 'test', ANTHROPIC_API_KEY: '', OPENAI_API_KEY: '' };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({
    cwd: root,
    args: ['.', '--no-sandbox', `--user-data-dir=${userData}`],
    env,
  });
  try {
    const page = await app.firstWindow();
    await page.getByRole('button', { name: 'Profile menu' }).click();
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Settings', exact: true });
    await expect(dialog.getByText('Connectors', { exact: true })).toBeVisible();
    await dialog.getByRole('searchbox', { name: 'Find a connector' }).fill('Google Drive');
    const drive = dialog.getByRole('checkbox', { name: /Google Drive/ });
    await expect(drive).not.toBeChecked();
    await drive.click();
    await expect(drive).toBeChecked();
    await dialog
      .getByRole('textbox', { name: 'Service name', exact: true })
      .fill('Procurement workspace');
    await dialog
      .getByRole('textbox', { name: 'Service HTTPS address' })
      .fill('https://workspace.example.com/');
    await dialog.getByRole('button', { name: 'Add connector', exact: true }).click();
    await dialog.getByRole('searchbox', { name: 'Find a connector' }).fill('Procurement');
    const custom = dialog.getByRole('checkbox', { name: /Procurement workspace/ });
    await expect(custom).not.toBeChecked();
    await custom.click();
    await expect(custom).toBeChecked();
    const stored = await page.evaluate(() => window.bullebrowser.connectors.list());
    expect(stored.find((entry) => entry.name === 'Procurement workspace')?.enabled).toBe(true);
    await dialog.getByRole('button', { name: 'Remove Procurement workspace' }).click();
    await expect(custom).toHaveCount(0);
    expect(
      (await page.evaluate(() => window.bullebrowser.connectors.list())).some(
        (entry) => entry.name === 'Procurement workspace',
      ),
    ).toBe(false);
    await page.screenshot({ path: 'test-results/connectors-settings.png' });
  } finally {
    await app.close();
    rmSync(userData, { recursive: true, force: true });
  }
});
