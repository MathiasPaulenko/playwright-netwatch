import { test } from '../../src/index.js';
import { startServer } from '../server.js';

test('dies on timeout with a hanging request', async ({ page }) => {
  test.setTimeout(1500);
  const server = await startServer();
  try {
    await page.goto(`${server.url}/ok`);
    void page.evaluate(() => {
      fetch('/hang').catch(() => {});
    });
    await page.waitForRequest((r) => r.url().includes('/hang'));

    await page.waitForTimeout(5000);
  } finally {
    await server.close();
  }
});
