import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './e2e/mobile', workers: 1, timeout: 30000,
  use: { channel: 'chrome', viewport: { width: 390, height: 844 }, reducedMotion: 'reduce', trace: 'retain-on-failure' },
  webServer: [
    { command: 'pnpm --filter @bullebrowser/mobile dev --port 4174', cwd: '../..', url: 'http://127.0.0.1:4174', reuseExistingServer: false },
  ],
});
