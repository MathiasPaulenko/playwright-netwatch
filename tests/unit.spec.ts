// Unit tests for the library's logic — fake page/requests, no browser.
import { EventEmitter } from 'node:events';
import { test, expect } from '@playwright/test';
import { Netwatch, expect as nwExpect } from '../src/index.js';
import type { Page, Request, WebSocket } from '@playwright/test';

function fakePage(): Page {
  return new EventEmitter() as unknown as Page;
}

function fakeRequest(
  url: string,
  options: { method?: string; resourceType?: string; failure?: string } = {},
): Request {
  return {
    url: () => url,
    method: () => options.method ?? 'GET',
    resourceType: () => options.resourceType ?? 'fetch',
    failure: () =>
      options.failure ? { errorText: options.failure } : null,
  } as unknown as Request;
}

function fakeSocket(url: string): WebSocket {
  const socket = new EventEmitter();
  let closed = false;
  socket.on('close', () => {
    closed = true;
  });
  return Object.assign(socket, {
    url: () => url,
    isClosed: () => closed,
  }) as unknown as WebSocket;
}

test.describe('Netwatch (unit)', () => {
  test('moves a request from pending to finished', () => {
    const page = new EventEmitter();
    const nw = new Netwatch(page as unknown as Page);

    const req = fakeRequest('http://x/api');
    page.emit('request', req);
    expect(nw.pending()).toHaveLength(1);

    page.emit('requestfinished', req);
    expect(nw.pending()).toHaveLength(0);
    const record = nw.history()[0];
    expect(record.outcome).toBe('finished');
    expect(record.durationMs).toBeGreaterThanOrEqual(0);
  });

  test('records failure text on requestfailed', () => {
    const page = new EventEmitter();
    const nw = new Netwatch(page as unknown as Page);

    const req = fakeRequest('http://x/api', { failure: 'net::ERR_ABORTED' });
    page.emit('request', req);
    page.emit('requestfailed', req);

    expect(nw.pending()).toHaveLength(0);
    expect(nw.history()[0].failure).toBe('net::ERR_ABORTED');
  });

  test('stats counts outcomes and open connections', () => {
    const page = new EventEmitter();
    const nw = new Netwatch(page as unknown as Page);

    const done = fakeRequest('http://x/done');
    const failed = fakeRequest('http://x/failed', { failure: 'boom' });
    page.emit('request', done);
    page.emit('requestfinished', done);
    page.emit('request', failed);
    page.emit('requestfailed', failed);
    page.emit('request', fakeRequest('http://x/pending'));
    page.emit('websocket', fakeSocket('ws://x/live'));

    expect(nw.stats()).toEqual({
      total: 3,
      pending: 1,
      finished: 1,
      failed: 1,
      openConnections: 1,
    });
  });

  test('drops closed websockets from openConnections', () => {
    const page = new EventEmitter();
    const nw = new Netwatch(page as unknown as Page);

    const ws = fakeSocket('ws://x/live');
    page.emit('websocket', ws);
    expect(nw.openConnections()).toHaveLength(1);

    (ws as unknown as EventEmitter).emit('close');
    expect(nw.openConnections()).toHaveLength(0);
  });

  test('dispose detaches page listeners', () => {
    const page = new EventEmitter();
    const nw = new Netwatch(page as unknown as Page);

    nw.dispose();
    page.emit('request', fakeRequest('http://x/api'));

    expect(nw.history()).toHaveLength(0);
  });
});

test.describe('waitForRequests (unit)', () => {
  test('resolves immediately when already idle', async () => {
    const nw = new Netwatch(fakePage());
    const remaining = await nw.waitForRequests({ idleMs: 10, timeout: 500 });
    expect(remaining).toEqual([]);
  });

  test('resolves when in-flight drops under the threshold', async () => {
    const page = new EventEmitter();
    const nw = new Netwatch(page as unknown as Page);

    const req = fakeRequest('http://x/slow');
    page.emit('request', req);
    const pending = nw.waitForRequests({ idleMs: 10, timeout: 1000 });
    page.emit('requestfinished', req);

    await expect(pending).resolves.toEqual([]);
  });

  test('rejects with TimeoutError listing pending requests', async () => {
    const page = new EventEmitter();
    const nw = new Netwatch(page as unknown as Page);

    page.emit('request', fakeRequest('http://x/hang', { method: 'POST' }));

    await expect(
      nw.waitForRequests({ idleMs: 10, timeout: 50 }),
    ).rejects.toThrow(/POST http:\/\/x\/hang/);
  });

  test('filtered requests do not count', async () => {
    const page = new EventEmitter();
    const nw = new Netwatch(page as unknown as Page);

    page.emit('request', fakeRequest('http://x/analytics'));

    const remaining = await nw.waitForRequests({
      idleMs: 10,
      timeout: 500,
      filter: { resourceType: 'fetch' },
    });
    expect(remaining).toEqual([]);
  });
});

test.describe('toHaveRequested (unit)', () => {
  test('matches a request already in history', async () => {
    const page = new EventEmitter();
    const nw = new Netwatch(page as unknown as Page);
    page.emit('request', fakeRequest('http://x/login', { method: 'POST' }));

    await nwExpect(nw).toHaveRequested('/login', { method: 'post' });
    await nwExpect(nw).not.toHaveRequested('/logout', { timeout: 100 });
  });
});
