import { defineConfig } from '@playwright/test';

// Electron renders into xvfb on Linux; never open or focus a user's browser.
if (process.platform !== 'linux') process.env.BULLEBROWSER_HIDDEN = '1';
export default defineConfig({
  testDir: './benchmarks', globalSetup: './benchmarks/global-setup.ts', timeout: 180_000, workers: 1, fullyParallel: false,
  retries: 0, reporter: [['list']], use: { trace: 'off' },
});
