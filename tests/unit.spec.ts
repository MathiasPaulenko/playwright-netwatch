// Unit tests for the library's logic — fake page/requests, no browser.
import { EventEmitter } from 'node:events';
import { test, expect } from '@playwright/test';
import { Netwatch, expect as nwExpect } from '../src/index.js';
import type { RequestFilter, WaitForRequestsOptions } from '../src/index.js';
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
    timing: () => ({
      startTime: 0,
      domainLookupStart: -1,
      domainLookupEnd: -1,
      connectStart: -1,
      connectEnd: -1,
      secureConnectionStart: -1,
      requestStart: 1,
      responseStart: 2,
      responseEnd: 3,
    }),
  } as unknown as Request;
}

function fakeResponse(request: Request, status: number) {
  return {
    request: () => request,
    status: () => status,
  };
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

  test('records response status and timing once finished', () => {
    const page = new EventEmitter();
    const nw = new Netwatch(page as unknown as Page);

    const req = fakeRequest('http://x/api');
    page.emit('request', req);
    page.emit('response', fakeResponse(req, 201));
    page.emit('requestfinished', req);

    const record = nw.history()[0];
    expect(record.status).toBe(201);
    expect(record.timing).toBeDefined();
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

test.describe('Netwatch edge cases (unit)', () => {
  test('throws a clear error when built without a Page', () => {
    expect(() => new Netwatch({} as Page)).toThrow(TypeError);
    expect(() => new Netwatch({} as Page)).toThrow(/Page/);
  });

  test('records finished requests even when timing() throws', () => {
    const page = new EventEmitter();
    const nw = new Netwatch(page as unknown as Page);
    const req = fakeRequest('http://x/api');
    (req as unknown as { timing: () => never }).timing = () => {
      throw new Error('timing unavailable');
    };
    page.emit('request', req);
    expect(() => page.emit('requestfinished', req)).not.toThrow();

    const record = nw.history()[0];
    expect(record.outcome).toBe('finished');
    expect(record.timing).toBeUndefined();
  });

  test('a throwing onChange listener does not break other listeners', async () => {
    const page = new EventEmitter();
    const nw = new Netwatch(page as unknown as Page);
    nw.onChange(() => {
      throw new Error('listener boom');
    });
    const req = fakeRequest('http://x/slow');
    expect(() => page.emit('request', req)).toThrow('listener boom');

    const pending = nw.waitForRequests({ idleMs: 10, timeout: 500 });
    expect(() => page.emit('requestfinished', req)).toThrow('listener boom');
    await expect(pending).resolves.toEqual([]);
  });

  test('onChange rejects non-function listeners', () => {
    const nw = new Netwatch(fakePage());
    expect(() =>
      nw.onChange('listener' as unknown as () => void),
    ).toThrow(TypeError);
  });

  test('mutating a history record does not corrupt internal state', () => {
    const page = new EventEmitter();
    const nw = new Netwatch(page as unknown as Page);
    const req = fakeRequest('http://x/api');
    page.emit('request', req);
    page.emit('requestfinished', req);

    nw.history()[0].timing!.responseEnd = -999;
    expect(nw.history()[0].timing!.responseEnd).toBe(3);
  });

  test('dispose stops change notifications from later socket closes', () => {
    const page = new EventEmitter();
    const nw = new Netwatch(page as unknown as Page);
    const ws = fakeSocket('ws://x/live');
    let calls = 0;
    nw.onChange(() => calls++);

    page.emit('websocket', ws);
    expect(calls).toBe(1);
    nw.dispose();
    (ws as unknown as EventEmitter).emit('close');
    expect(calls).toBe(1);
  });
});

test.describe('waitForRequests validation (unit)', () => {
  test('rejects non-finite or negative options', () => {
    const nw = new Netwatch(fakePage());
    expect(() => nw.waitForRequests({ below: -1 })).toThrow(RangeError);
    expect(() => nw.waitForRequests({ below: Number.NaN })).toThrow(RangeError);
    expect(() => nw.waitForRequests({ idleMs: -5 })).toThrow(RangeError);
    expect(() => nw.waitForRequests({ idleMs: Number.NaN })).toThrow(
      RangeError,
    );
    expect(() => nw.waitForRequests({ timeout: Number.NaN })).toThrow(
      RangeError,
    );
  });

  test('rejects non-numeric timeouts', () => {
    const nw = new Netwatch(fakePage());
    expect(() =>
      nw.waitForRequests({ timeout: '500' as unknown as number }),
    ).toThrow(RangeError);
    expect(() =>
      nw.waitForRequests({ timeout: true as unknown as number }),
    ).toThrow(RangeError);
  });

  test('accepts a null options object', async () => {
    const nw = new Netwatch(fakePage());
    const remaining = await nw.waitForRequests(
      null as unknown as WaitForRequestsOptions,
    );
    expect(remaining).toEqual([]);
  });

  test('rejects non-object filters and invalid filter fields', () => {
    const nw = new Netwatch(fakePage());
    expect(() =>
      nw.waitForRequests({ filter: /hang/ as unknown as RequestFilter }),
    ).toThrow(TypeError);
    expect(() =>
      nw.waitForRequests({
        filter: [['url']] as unknown as RequestFilter[],
      }),
    ).toThrow(TypeError);
    expect(() =>
      nw.waitForRequests({ filter: { url: 5 as unknown as string } }),
    ).toThrow(TypeError);
    expect(() =>
      nw.waitForRequests({
        filter: { resourceType: 5 as unknown as string },
      }),
    ).toThrow(TypeError);
  });

  test('filter accepts a resourceType list', async () => {
    const page = new EventEmitter();
    const nw = new Netwatch(page as unknown as Page);
    page.emit(
      'request',
      fakeRequest('http://x/stream', { resourceType: 'eventsource' }),
    );

    const remaining = await nw.waitForRequests({
      idleMs: 10,
      timeout: 500,
      filter: { resourceType: ['eventsource', 'websocket'] },
    });
    expect(remaining).toEqual([]);
  });

  test('timeout Infinity waits instead of firing instantly', async () => {
    const page = new EventEmitter();
    const nw = new Netwatch(page as unknown as Page);
    const req = fakeRequest('http://x/slow');
    page.emit('request', req);

    let settled = false;
    const pending = nw.waitForRequests({ idleMs: 10, timeout: Infinity });
    void pending.then(
      () => (settled = true),
      () => (settled = true),
    );
    await new Promise((r) => setTimeout(r, 150));
    expect(settled).toBe(false);

    page.emit('requestfinished', req);
    await expect(pending).resolves.toEqual([]);
  });

  test('global-flag regex filters stay deterministic', async () => {
    const page = new EventEmitter();
    const nw = new Netwatch(page as unknown as Page);
    page.emit('request', fakeRequest('http://x/analytics'));

    const filter = { url: /analytics/g };
    const first = await nw.waitForRequests({ idleMs: 10, timeout: 500, filter });
    const second = await nw.waitForRequests({
      idleMs: 10,
      timeout: 500,
      filter,
    });
    expect(first).toEqual([]);
    expect(second).toEqual([]);
  });
});

test.describe('toHaveRequested edge cases (unit)', () => {
  test('throws a clear error for non-Netwatch received', async () => {
    await expect(nwExpect(undefined).toHaveRequested('/x')).rejects.toThrow(
      /Netwatch/,
    );
    await expect(nwExpect(undefined).not.toHaveRequested('/x')).rejects.toThrow(
      /Netwatch/,
    );
  });

  test('rejects invalid url patterns', async () => {
    const page = new EventEmitter();
    const nw = new Netwatch(page as unknown as Page);
    page.emit('request', fakeRequest('http://x/login'));
    await expect(
      nwExpect(nw).toHaveRequested(null as unknown as string, { timeout: 100 }),
    ).rejects.toThrow(/string|RegExp|predicate/);
  });

  test('rejects invalid method, status and timeout options', async () => {
    const page = new EventEmitter();
    const nw = new Netwatch(page as unknown as Page);
    await expect(
      nwExpect(nw).toHaveRequested('/x', {
        method: 5 as unknown as string,
      }),
    ).rejects.toThrow(TypeError);
    await expect(
      nwExpect(nw).toHaveRequested('/x', {
        status: '200' as unknown as number,
      }),
    ).rejects.toThrow(TypeError);
    await expect(
      nwExpect(nw).toHaveRequested('/x', {
        timeout: 'soon' as unknown as number,
      }),
    ).rejects.toThrow(RangeError);
  });

  test('global-flag regex patterns match repeatedly', async () => {
    const page = new EventEmitter();
    const nw = new Netwatch(page as unknown as Page);
    page.emit('request', fakeRequest('http://x/login'));

    const pattern = /login/g;
    await nwExpect(nw).toHaveRequested(pattern, { timeout: 0 });
    await nwExpect(nw).toHaveRequested(pattern, { timeout: 0 });
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

  test('matches by response status', async () => {
    const page = new EventEmitter();
    const nw = new Netwatch(page as unknown as Page);

    const req = fakeRequest('http://x/login', { method: 'POST' });
    page.emit('request', req);
    page.emit('response', fakeResponse(req, 200));

    await nwExpect(nw).toHaveRequested('/login', { status: 200 });
    await nwExpect(nw).not.toHaveRequested('/login', {
      status: 500,
      timeout: 100,
    });
  });
});
