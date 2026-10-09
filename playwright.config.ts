import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testIgnore: ['**/fixtures/**'],
  fullyParallel: true,
  reporter: 'list',
  use: {
    browserName: 'chromium',
    // Device Guard on dev machines blocks playwright-managed browsers;
    // fall back to system Chrome locally, bundled chromium in CI.
    channel: process.env.CI ? undefined : 'chrome',
  },
});
