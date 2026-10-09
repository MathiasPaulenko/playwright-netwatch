import { defineConfig } from '@playwright/test';

// Config for the meta-tests: runs only the fixture specs in this folder.
export default defineConfig({
  testDir: '.',
  workers: 1,
  reporter: 'list',
  use: {
    channel: process.env.CI ? undefined : 'chrome',
  },
});
