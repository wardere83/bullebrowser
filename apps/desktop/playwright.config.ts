import { defineConfig } from '@playwright/test';

// On a desktop the suite drives the real app with no visible window and without
// taking focus (see runsHidden() in src/main/window.ts), so it can run while the
// machine is in use. Set BULLEBROWSER_HIDDEN=0 to watch a run. CI on Linux
// already renders into a virtual display, so it is left as it was.
if (process.platform !== 'linux') process.env.BULLEBROWSER_HIDDEN ??= '1';

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    trace: 'retain-on-failure',
  },
});
