import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  reporter: [['list']],
  use: {
    // Chromium-based mobile device: only Chromium is installed in this environment.
    ...devices['Pixel 7'],
    hasTouch: true,
    // The installed browser revision doesn't ship chrome-headless-shell; point
    // directly at the full Chromium binary instead (it also supports headless mode).
    launchOptions: {
      executablePath: '/opt/pw-browsers/chromium',
    },
  },
});
