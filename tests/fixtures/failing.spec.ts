import { test, expect } from '../../src/index.js';
import { startServer } from '../server.js';

test('fails with a hanging request and an open socket', async ({ page }) => {
  const server = await startServer();
  try {
    await page.goto(`${server.url}/ok`);
    void page.evaluate(() => {
      fetch('/hang').catch(() => {});
    });
    await page.waitForRequest((r) => r.url().includes('/hang'));

    void page.evaluate((wsUrl) => {
      // @ts-expect-error test-only global
      window.__ws = new WebSocket(`${wsUrl}/ws`);
    }, server.wsUrl);
    await page.waitForEvent('websocket');

    expect(true).toBe(false);
  } finally {
    await server.close();
  }
});
