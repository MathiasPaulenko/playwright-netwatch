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

test('tracks in-flight requests until they finish', async ({ page }) => {
  const nw = new Netwatch(page);
  await page.goto(`${server.url}/ok`);

  void page.evaluate(() => {
    fetch('/slow?ms=300').catch(() => {});
  });
  await expect.poll(() => nw.pending().length).toBe(1);

  const pending = nw.pending()[0];
  expect(pending.url).toContain('/slow');
  expect(pending.method).toBe('GET');
  expect(pending.resourceType).toBe('fetch');
  expect(pending.elapsedMs).toBeGreaterThanOrEqual(0);

  await page.waitForResponse((r) => r.url().includes('/slow'));
  await expect.poll(() => nw.pending().length).toBe(0);
});

test('moves failed requests out of pending and into history', async ({ page }) => {
  const nw = new Netwatch(page);
  await page.goto(`${server.url}/ok`);

  await page.evaluate(() => {
    const controller = new AbortController();
    fetch('/hang', { signal: controller.signal }).catch(() => {});
    setTimeout(() => controller.abort(), 100);
  });

  await expect
    .poll(() => nw.history().some((r) => r.url.includes('/hang') && r.outcome === 'failed'))
    .toBe(true);
  expect(nw.pending().filter((p) => p.url.includes('/hang'))).toHaveLength(0);
});

test('records finished requests in history', async ({ page }) => {
  const nw = new Netwatch(page);
  await page.goto(`${server.url}/ok`);
  await page.evaluate(() => fetch('/slow?ms=50'));
  await expect
    .poll(() =>
      nw.history().some((r) => r.url.includes('/slow') && r.outcome === 'finished'),
    )
    .toBe(true);

  const record = nw.history().find((r) => r.url.includes('/slow'));
  expect(record?.durationMs).toBeGreaterThanOrEqual(50);
});

test('reports open websockets and drops closed ones', async ({ page }) => {
  const nw = new Netwatch(page);
  await page.goto(`${server.url}/ok`);

  await page.evaluate((wsUrl) => {
    // @ts-expect-error test-only global
    window.__ws = new WebSocket(`${wsUrl}/ws`);
  }, server.wsUrl);

  await expect.poll(() => nw.openConnections().length).toBe(1);
  expect(nw.openConnections()[0].url).toContain('/ws');

  await page.evaluate(() => {
    // @ts-expect-error test-only global
    window.__ws.close();
  });
  await expect.poll(() => nw.openConnections().length).toBe(0);
});

test('stops tracking after dispose', async ({ page }) => {
  const nw = new Netwatch(page);
  await page.goto(`${server.url}/ok`);
  nw.dispose();

  await page.evaluate(() => fetch('/slow?ms=50'));

  expect(nw.pending()).toHaveLength(0);
  expect(nw.history().some((r) => r.url.includes('/slow'))).toBe(false);
});
