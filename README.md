# playwright-netwatch

Network diagnostics for Playwright tests.

- Pending-request dump attached to the report when a test fails or times out
- Open WebSocket/SSE connections reported alongside
- `waitForRequests()` — granular network-idle waits that survive pings, analytics and SSE
- `expect(netwatch).toHaveRequested()` — retried request assertions

## Install

```bash
npm install -D playwright-netwatch
```

## Usage

```ts
import { test, expect } from 'playwright-netwatch';
```

Full docs coming with the first release.
