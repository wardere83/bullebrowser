import { test, expect, _electron as electron } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(here, '..');

async function launch(
  {
    openAiOnly = false,
    withoutOpenAiKey = false,
  }: { openAiOnly?: boolean; withoutOpenAiKey?: boolean } = {},
) {
  // Fresh user-data dir per test so we always start from default settings.
  const userData = mkdtempSync(join(tmpdir(), 'bullebrowser-e2e-'));

  // ELECTRON_RUN_AS_NODE must NOT be inherited. If it is set, the Electron
  // binary runs as plain Node: there is no app and no window, and the
  // --remote-debugging-port Playwright passes ahead of the app path is parsed
  // as a Node flag, so launch dies with "bad option:
  // --remote-debugging-port=0". Some editor/agent shells export it, which makes
  // the whole suite look like a Playwright/Electron incompatibility when it is
  // really just a stray environment variable.
  const env = { ...process.env, NODE_ENV: 'test' };
  delete env.ELECTRON_RUN_AS_NODE;

  // The panel renders the "connect your key" state instead of the composer
  // when no key is configured, so without this every assertion below about the
  // textarea, the "+" menu or the voice controls fails — which is exactly why
  // this suite passed locally (a developer .env supplies ANTHROPIC_API_KEY) and
  // failed on CI, where there is no .env. hasApiKey() falls back to the
  // environment, so a fixture value is enough to render the composer. It is
  // never used to reach the network: no test here starts an agent run.
  delete env.ANTHROPIC_API_KEY;
  delete env.OPENAI_API_KEY;
  if (!openAiOnly) {
    env.ANTHROPIC_API_KEY = 'sk-ant-e2e-fixture-key-not-real-0000000000000000';
  }
  // Voice controls need Whisper's OpenAI credential even in the normal
  // Anthropic-assistant fixture. An explicit empty value also prevents the
  // app's development .env loader from supplying one in the missing-key test.
  env.OPENAI_API_KEY = withoutOpenAiKey
    ? ''
    : 'sk-e2e-fixture-key-not-real-0000000000000000';

  const app = await electron.launch({
    args: ['.', '--no-sandbox', `--user-data-dir=${userData}`],
    cwd: appRoot,
    env,
  });
  const win = await app.firstWindow({ timeout: 20_000 });
  await win.waitForLoadState('domcontentloaded');

  // The panel ships open by default; open it idempotently either way.
  const panelHeader = win.locator('aside').getByText('BulleBrowser Agent');
  if (!(await panelHeader.isVisible().catch(() => false))) {
    await win.getByRole('button', { name: 'Your Assistant' }).click();
  }
  await expect(panelHeader).toBeVisible({ timeout: 10_000 });
  return { app, win };
}

test('the agent panel mounts with its composer', async () => {
  const { app, win } = await launch();
  await expect(win.locator('aside').getByText('BulleBrowser Agent')).toBeVisible();
  await expect(win.locator('aside textarea')).toBeEnabled();
  await app.close();
});

test('the composer exposes the attachment menu and voice controls', async () => {
  const { app, win } = await launch();
  await expect(win.locator('[aria-label="Add attachment"]')).toBeVisible();
  await expect(win.locator('[aria-label="Voice input"]')).toBeVisible();
  await expect(win.locator('[aria-label="Voice Mode"]')).toBeVisible();
  await expect(win.locator('[aria-label="Open bullebrowser.com"]')).toBeVisible();
  await app.close();
});

test('a saved OpenAI key enables the assistant and voice controls', async () => {
  const { app, win } = await launch({ openAiOnly: true });
  const savedModel = await win.evaluate(async () => {
    await window.bullebrowser.secrets.setApiKey(
      'sk-e2e-saved-openai-key-not-real-0000000000000000',
      'openai',
    );
    await window.bullebrowser.settings.set({ defaultModel: 'gpt-4o' });
    return (await window.bullebrowser.settings.get()).defaultModel;
  });
  expect(savedModel).toBe('gpt-4o');
  await win.reload();
  await expect(win.locator('aside textarea')).toBeEnabled();
  await expect(win.locator('[aria-label="Voice input"]')).toBeVisible();
  await expect(win.locator('[aria-label="Voice Mode"]')).toBeVisible();
  await app.close();
});

test('voice controls open Settings when the OpenAI key is absent', async () => {
  const { app, win } = await launch({ withoutOpenAiKey: true });
  await win.locator('[aria-label="Voice input"]').click();
  await expect(win.getByText('Voice (OpenAI) key', { exact: true })).toBeVisible();
  await expect(win.getByRole('button', { name: 'Cancel' })).toBeHidden();
  await app.close();
});

test('the "+" menu opens with every attachment source', async () => {
  const { app, win } = await launch();
  await win.locator('[aria-label="Add attachment"]').click();
  for (const label of ['Upload your file', 'Screenshot', 'Projects', 'Control Browser']) {
    await expect(win.getByText(label, { exact: true })).toBeVisible();
  }
  // The 8-day retention promise is part of the contract with the user.
  await expect(win.getByText(/retained for 8 days/i)).toBeVisible();
  await app.close();
});

test('the "+" menu closes on an outside click', async () => {
  const { app, win } = await launch();
  await win.locator('[aria-label="Add attachment"]').click();
  await expect(win.getByText('Upload your file', { exact: true })).toBeVisible();
  await win.locator('aside').getByText('BulleBrowser Agent').click();
  await expect(win.getByText('Upload your file', { exact: true })).toBeHidden();
  await app.close();
});

// The overlay must appear and be dismissable even where no microphone exists —
// the path most users hit first if permissions are not yet granted.
test('voice input opens an overlay that can be dismissed', async () => {
  const { app, win } = await launch();
  await win.locator('[aria-label="Voice input"]').click();
  await expect(win.getByRole('button', { name: 'Cancel' })).toBeVisible({ timeout: 10_000 });
  await win.getByRole('button', { name: 'Cancel' }).click();
  await expect(win.getByRole('button', { name: 'Cancel' })).toBeHidden();
  await expect(win.locator('aside textarea')).toBeEnabled();
  await app.close();
});

test('Voice Mode opens live voice controls and stops again', async () => {
  const { app, win } = await launch();
  await win.locator('[aria-label="Voice Mode"]').click();
  const stop = win.getByRole('button', { name: 'Stop Voice Mode' });
  await expect(stop).toBeVisible({ timeout: 10_000 });
  await stop.click();
  await expect(stop).toBeHidden();
  await app.close();
});

// Whether a microphone exists varies by machine, so don't assert a specific
// outcome — assert the invariant that used to be violated: the overlay must
// never STAY on "Starting microphone…". It has to resolve one way or the
// other (listening, or an actionable error), rather than hang forever.
test('microphone startup always resolves and never hangs', async () => {
  const { app, win } = await launch();
  await win.locator('[aria-label="Voice input"]').click();
  await expect(win.getByText(/Starting microphone/i)).toBeVisible({ timeout: 5_000 });
  await expect(win.getByText(/Starting microphone/i)).toBeHidden({ timeout: 20_000 });
  await app.close();
});
