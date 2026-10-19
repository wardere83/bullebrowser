import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './e2e/website', workers: 1, timeout: 30000,
  use: { channel: 'chrome', viewport: { width: 1440, height: 1050 }, reducedMotion: 'reduce', trace: 'retain-on-failure' },
  webServer: { command: 'python3 -m http.server 4177 --bind 127.0.0.1 --directory apps/web/out', cwd: '../..', url: 'http://127.0.0.1:4177', reuseExistingServer: false },
});
