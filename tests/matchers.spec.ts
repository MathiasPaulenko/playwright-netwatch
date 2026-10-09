import { test, expect } from '../src/index.js';
import { startServer, type TestServer } from './server.js';

let server: TestServer;

test.beforeEach(async () => {
  server = await startServer();
});

test.afterEach(async () => {
  await server.close();
});

test('toHaveRequested matches a completed request', async ({
  page,
  netwatch,
}) => {
  await page.goto(`${server.url}/ok`);
  await page.evaluate(() => fetch('/slow?ms=50'));
  await expect(netwatch).toHaveRequested('/slow');
});

test('toHaveRequested matches by regex and method', async ({
  page,
  netwatch,
}) => {
  await page.goto(`${server.url}/ok`);
  await page.evaluate(() => fetch('/ok', { method: 'POST' }));
  await expect(netwatch).toHaveRequested(/\/ok$/, { method: 'POST' });
});

test('toHaveRequested matches requests still in flight', async ({
  page,
  netwatch,
}) => {
  await page.goto(`${server.url}/ok`);
  void page.evaluate(() => {
    fetch('/hang').catch(() => {});
  });
  await expect(netwatch).toHaveRequested('/hang');
});

test('toHaveRequested waits for a request that arrives later', async ({
  page,
  netwatch,
}) => {
  await page.goto(`${server.url}/ok`);
  void page.evaluate(async () => {
    await new Promise((r) => setTimeout(r, 300));
    fetch('/slow?ms=50').catch(() => {});
  });
  await expect(netwatch).toHaveRequested('/slow', { timeout: 5000 });
});

test('toHaveRequested fails listing the requests it saw', async ({
  page,
  netwatch,
}) => {
  await page.goto(`${server.url}/ok`);
  await page.evaluate(() => fetch('/ok'));

  await expect(
    expect(netwatch).toHaveRequested('/nope', { timeout: 500 }),
  ).rejects.toThrow(/GET http.*\/ok/);
});

test('toHaveRequested.not passes when the request was never made', async ({
  page,
  netwatch,
}) => {
  await page.goto(`${server.url}/ok`);
  await expect(netwatch).not.toHaveRequested('/never-called', {
    timeout: 500,
  });
});
