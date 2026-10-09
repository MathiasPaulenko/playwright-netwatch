import { test, expect } from '../../src/index.js';
import { startServer } from '../server.js';

test('passes with quiet network', async ({ page, netwatch }) => {
  const server = await startServer();
  try {
    await page.goto(`${server.url}/ok`);
    expect(netwatch.pending()).toHaveLength(0);
  } finally {
    await server.close();
  }
});
