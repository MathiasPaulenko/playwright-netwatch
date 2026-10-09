# playwright-netwatch

Network diagnostics for Playwright tests. Passive observation only — no interception, no mocking.

Answers two questions that are painful today:

1. **"Why did my test die on the network?"** — when a test fails or times out, netwatch attaches a dump of the requests still in flight (with elapsed time) and the open websockets to the test report.
2. **"How do I wait for the network to actually settle?"** — `waitForRequests()` is a granular network-idle wait that tolerates health pings, analytics and SSE, where `waitForLoadState('networkidle')` hangs forever.

## Install

```bash
npm install -D playwright-netwatch
```

Requires `@playwright/test` (peer dependency, `^1.40.0`).

## Quick start

Replace your `@playwright/test` import:

```ts
import { test, expect } from 'playwright-netwatch';

test('checkout', async ({ page }) => {
  await page.goto('/shop');
  // if this test fails or times out, the report gets a
  // `netwatch-pending` attachment with what was still in flight
});
```

The `netwatch` fixture is automatic — every test gets a tracker on its `page`, no signature change needed. Destructure it when you want to drive `waitForRequests` or the assertions:

```ts
test('checkout', async ({ page, netwatch }) => {
  await netwatch.waitForRequests({ below: 0 });
});
```

On failure, the report includes an attachment like:

```json
{
  "pending": [
    {
      "url": "https://api.example.com/payments",
      "method": "POST",
      "resourceType": "fetch",
      "startedAt": 1791551255789,
      "elapsedMs": 12300
    }
  ],
  "connections": [
    {
      "type": "websocket",
      "url": "wss://example.com/live",
      "openedAt": 1791551244000,
      "elapsedMs": 25000
    }
  ]
}
```

Nothing is attached when the test ends with its expected status.

## `waitForRequests` — network idle that works

```ts
await netwatch.waitForRequests({
  below: 0,       // resolve when ≤ N requests are in flight (default 0)
  idleMs: 500,    // ...for this many consecutive ms (default 500)
  timeout: 10000, // give up after this (default 30000, 0 disables)
});
```

Ignore traffic you don't care about — analytics, telemetry, an SSE stream that never ends:

```ts
await netwatch.waitForRequests({
  below: 0,
  filter: [
    { url: /analytics|telemetry/ },
    { resourceType: 'eventsource' },
  ],
});
```

A request is ignored when it matches every specified field of a filter (`url` as substring, `RegExp` or predicate; `resourceType` as string or list). Multiple filters are OR'ed.

On timeout it throws a `TimeoutError` listing what was still in flight:

```
waitForRequests timed out after 10000ms: 1 request(s) still in flight
  GET https://api.example.com/feed (10.0s in flight)
```

## `toHaveRequested` — request assertions

```ts
await expect(netwatch).toHaveRequested('/api/login', { method: 'POST' });
await expect(netwatch).toHaveRequested(/\/users\/\d+/);
await expect(netwatch).toHaveRequested((r) => r.url.includes('batch'));
```

`urlOrPattern` accepts a substring, `RegExp`, or predicate over the request record. Options: `method`, `timeout` (default 5000). It polls the request history — completed *and* in-flight requests count. On failure the error lists every request seen.

`not` works too: `await expect(netwatch).not.toHaveRequested('/api/mutate')`.

## Standalone use

The tracker works without the fixture — useful for custom setups or extra pages:

```ts
import { Netwatch } from 'playwright-netwatch';

const netwatch = new Netwatch(page);
// ...
netwatch.pending();          // in-flight requests with elapsedMs
netwatch.openConnections();  // live websockets
netwatch.history();          // all requests seen (pending/finished/failed)
netwatch.dispose();          // detach listeners when done
```

## API

| Export | Description |
| --- | --- |
| `test`, `expect` | Playwright `test` extended with the `netwatch` fixture; `expect` extended with `toHaveRequested` |
| `Netwatch` | `new Netwatch(page)`, `pending()`, `openConnections()`, `history()`, `waitForRequests()`, `onChange()`, `dispose()` |
| Types | `PendingRequest`, `OpenConnection`, `RequestRecord`, `RequestOutcome`, `RequestFilter`, `WaitForRequestsOptions`, `ToHaveRequestedOptions`, `UrlPattern`, `NetwatchFixtures` |

## Notes

- The automatic fixture creates a `page` (and its tracker) for every test using this `test` — including tests that would not otherwise need one. If that matters in a suite, import `test` from `@playwright/test` there instead.
- SSE connections appear as in-flight requests with `resourceType: 'eventsource'` — filter them out of `waitForRequests` if they never close.
- The tracker observes the page it's constructed on. Requests made by other pages in the same context are not tracked.
- History grows for the life of the tracker; it's disposed automatically at the end of each test via the fixture.

## License

MIT
