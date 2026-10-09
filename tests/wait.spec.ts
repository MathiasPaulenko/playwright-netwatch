import { test, expect } from '@playwright/test';
import { Netwatch } from '../src/index.js';
import { startServer, type TestServer } from './server.js';

let server: TestServer;

test.beforeEach(async () => {
  server = await startServer();
});

test.afterEach(async () => {
  await server.close();
});

test('resolves once in-flight requests drop to zero', async ({ page }) => {
  const nw = new Netwatch(page);
  await page.goto(`${server.url}/ok`);

  void page.evaluate(() => {
    fetch('/slow?ms=200').catch(() => {});
  });
  const started = Date.now();
  await nw.waitForRequests({ below: 0, idleMs: 100, timeout: 5000 });

  expect(Date.now() - started).toBeGreaterThanOrEqual(150);
  expect(nw.pending()).toHaveLength(0);
});

test('resolves under threshold while ignored connections stay open', async ({
  page,
}) => {
  const nw = new Netwatch(page);
  await page.goto(`${server.url}/ok`);

  await page.evaluate(() => new EventSource('/sse'));
  await expect.poll(() => nw.pending().length).toBe(1);

  // below:0 would never settle — the SSE request stays in flight forever.
  await nw.waitForRequests({
    below: 0,
    idleMs: 100,
    timeout: 3000,
    filter: { resourceType: 'eventsource' },
  });
});

test('respects below threshold with multiple in-flight', async ({ page }) => {
  const nw = new Netwatch(page);
  await page.goto(`${server.url}/ok`);

  void page.evaluate(() => {
    fetch('/hang').catch(() => {});
    fetch('/hang?x=2').catch(() => {});
  });
  await expect.poll(() => nw.pending().length).toBe(2);

  const started = Date.now();
  await nw.waitForRequests({ below: 2, idleMs: 100, timeout: 3000 });
  expect(Date.now() - started).toBeLessThan(1500);
});

test('times out with a clear error listing pending requests', async ({
  page,
}) => {
  const nw = new Netwatch(page);
  await page.goto(`${server.url}/ok`);

  void page.evaluate(() => {
    fetch('/hang').catch(() => {});
  });
  await expect.poll(() => nw.pending().length).toBe(1);

  await expect(
    nw.waitForRequests({ below: 0, idleMs: 100, timeout: 500 }),
  ).rejects.toThrow(/\/hang/);
});

test('waits for a stable idle window, resetting on new activity', async ({
  page,
}) => {
  const nw = new Netwatch(page);
  await page.goto(`${server.url}/ok`);

  void page.evaluate(async () => {
    for (let i = 0; i < 3; i++) {
      await fetch('/slow?ms=50');
      await new Promise((r) => setTimeout(r, 150));
    }
  });

  const started = Date.now();
  await nw.waitForRequests({ below: 0, idleMs: 400, timeout: 10_000 });
  expect(Date.now() - started).toBeGreaterThan(700);
});

test('filter ignores requests by url pattern', async ({ page }) => {
  const nw = new Netwatch(page);
  await page.goto(`${server.url}/ok`);

  void page.evaluate(() => {
    fetch('/hang?source=analytics').catch(() => {});
    fetch('/slow?ms=100').catch(() => {});
  });
  await expect
    .poll(() => nw.pending().some((p) => p.url.includes('analytics')))
    .toBe(true);

  await nw.waitForRequests({
    below: 0,
    idleMs: 100,
    timeout: 3000,
    filter: { url: /source=analytics/ },
  });
});
