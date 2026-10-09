import { test, expect } from '../../src/index.js';
import { startServer } from '../server.js';

test('passes with quiet network', async ({ page }) => {
  const server = await startServer();
  try {
    await page.goto(`${server.url}/ok`);
    expect(true).toBe(true);
  } finally {
    await server.close();
  }
});
