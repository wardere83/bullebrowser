import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';
const evidence = (name: string) =>
  fileURLToPath(new URL(`../../../../docs/mobile/evidence/${name}`, import.meta.url));

test('mobile Settings permission and connector controls (native bridge fixture, not a device test)', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const state = {
      browsing: false,
      files: false,
      externalApps: false,
      enabledConnectors: [] as string[],
      customConnectors: [] as unknown[],
      hasKeyAnthropic: false,
      hasKeyOpenai: false,
    };
    const mobileWindow = window as unknown as Record<string, unknown>;
    mobileWindow.androidBridge = {};
    mobileWindow.Capacitor = {
      PluginHeaders: [
        {
          name: 'MobileAgent',
          methods: ['getState', 'setAccess', 'setConnectors', 'setKey', 'viewport', 'browser'].map(
            (name) => ({ name, rtype: 'promise' }),
          ),
        },
      ],
      nativePromise: async (_plugin: string, method: string, input: Record<string, unknown>) => {
        if (method === 'getState') return structuredClone(state);
        if (method === 'setAccess') {
          Object.assign(state, { [input.capability as string]: input.enabled });
          return;
        }
        if (method === 'setConnectors') {
          state.enabledConnectors = input.enabled as string[];
          state.customConnectors = input.custom as unknown[];
          return;
        }
        if (method === 'browser') return { tabs: [] };
        if (method === 'viewport') {
          mobileWindow.lastViewport = input;
          return;
        }
        throw new Error('No real device capability is available in this fixture.');
      },
    };
  });
  await page.goto('http://127.0.0.1:4174');
  await expect(page.getByRole('heading', { name: 'Your Assistant' })).toBeVisible();
  await page.screenshot({ path: evidence('mobile-assistant-fixture.png'), fullPage: true });
  await page.getByRole('button', { name: 'Open Settings' }).click();
  const browsing = page.getByRole('checkbox', { name: /Browse websites/ });
  await expect(browsing).not.toBeChecked();
  await browsing.check();
  await expect(browsing).toBeChecked();
  await page.getByRole('searchbox', { name: 'Find a connector' }).fill('Microsoft');
  await expect(page.getByRole('checkbox', { name: /^Microsoft 365/ })).toBeVisible();
  await page.getByRole('checkbox', { name: /^Microsoft 365/ }).check();
  await page.getByRole('textbox', { name: 'Service name', exact: true }).fill('My workspace');
  await page.getByRole('textbox', { name: 'HTTPS website' }).fill('https://workspace.example.com');
  await page.getByRole('button', { name: 'Add connector', exact: true }).click();
  await page.getByRole('searchbox', { name: 'Find a connector' }).fill('My workspace');
  const custom = page.getByRole('checkbox', { name: /My workspace/ });
  await expect(custom).not.toBeChecked();
  await custom.check();
  await expect(custom).toBeChecked();
  expect(
    await page.evaluate(
      () => (window as unknown as { lastViewport: { visible: boolean } }).lastViewport.visible,
    ),
  ).toBe(false);
  await page.screenshot({ path: evidence('mobile-settings-fixture.png'), fullPage: true });
  await page.getByRole('button', { name: 'Remove My workspace' }).click();
  await expect(custom).toHaveCount(0);
  await browsing.uncheck();
  await expect(browsing).not.toBeChecked();
});

test('opening Settings stops an in-flight assistant and keeps the native browser hidden (bridge fixture)', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const fixture = window as unknown as Record<string, unknown>;
    fixture.androidBridge = {};
    fixture.Capacitor = {
      PluginHeaders: [
        {
          name: 'MobileAgent',
          methods: ['getState', 'viewport', 'browser', 'requestModel', 'cancelModel'].map(
            (name) => ({ name, rtype: 'promise' }),
          ),
        },
      ],
      nativePromise: async (_plugin: string, method: string, input: Record<string, unknown>) => {
        if (method === 'getState')
          return {
            browsing: true,
            files: false,
            externalApps: false,
            enabledConnectors: [],
            customConnectors: [],
            hasKeyAnthropic: true,
            hasKeyOpenai: false,
          };
        if (method === 'viewport') {
          fixture.lastViewport = input;
          return;
        }
        if (method === 'browser') {
          const tab = {
            id: 'tab',
            title: 'Official source',
            url: 'https://agency.gov/',
            active: true,
          };
          if (input.action === 'list') return { tabs: [tab] };
          if (input.action === 'switch') return { tab };
          return { value: { text: 'An official public source.' } };
        }
        if (method === 'requestModel') {
          fixture.requestStarted = true;
          fixture.requestCount = Number(fixture.requestCount ?? 0) + 1;
          return new Promise(() => {});
        }
        if (method === 'cancelModel') {
          fixture.requestStopped = true;
          return;
        }
        throw Error('Unsupported fixture method.');
      },
    };
  });
  await page.goto('http://127.0.0.1:4174');
  await page
    .getByRole('textbox', { name: 'Your goal', exact: true })
    .fill('Summarize the current page');
  await page.locator('.composer').evaluate((form: HTMLFormElement) => {
    form.requestSubmit();
    form.requestSubmit();
  });
  await expect
    .poll(() =>
      page.evaluate(() => (window as unknown as { requestStarted: boolean }).requestStarted),
    )
    .toBe(true);
  expect(
    await page.evaluate(() => (window as unknown as { requestCount: number }).requestCount),
  ).toBe(1);
  await page.getByRole('button', { name: 'Open Settings', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => (window as unknown as { requestStopped: boolean }).requestStopped),
    )
    .toBe(true);
  await expect(page.getByRole('button', { name: 'Stop current task' })).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as { lastViewport: { visible: boolean } }).lastViewport.visible,
      ),
    )
    .toBe(false);
  await page.getByRole('button', { name: 'Back to assistant', exact: true }).click();
  await page
    .getByRole('textbox', { name: 'Your goal', exact: true })
    .fill('Keep this draft while opening Settings');
  await page.evaluate(() => {
    (document.querySelector('.composer') as HTMLFormElement).requestSubmit();
    (document.querySelector('[aria-label="Open Settings"]') as HTMLButtonElement).click();
  });
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Back to assistant', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Your goal', exact: true })).toHaveValue(
    'Keep this draft while opening Settings',
  );
  expect(
    await page.evaluate(() => (window as unknown as { requestCount: number }).requestCount),
  ).toBe(1);
});
