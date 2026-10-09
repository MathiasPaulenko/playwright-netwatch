import { expect } from '@playwright/test';
import { test } from '../../src/index.js';
import { startServer } from '../server.js';

test('fails with a hanging request in flight', async ({ page, netwatch }) => {
  const server = await startServer();
  try {
    await page.goto(`${server.url}/ok`);
    void page.evaluate(() => fetch('/hang'));
    await expect.poll(() => netwatch.pending().length).toBe(1);

    expect(true).toBe(false);
  } finally {
    await server.close();
  }
});
