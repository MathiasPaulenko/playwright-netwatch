import { test as base } from '@playwright/test';
import { expect } from './matchers.js';
import { Netwatch } from './tracker.js';

export interface NetwatchFixtures {
  /** Automatic tracker on the test's page. Destructure it to use it. */
  netwatch: Netwatch;
}

/**
 * Extended `test` with an automatic `netwatch` fixture: every test gets
 * a tracker on its page, whether it asks for it or not. When the test
 * does not finish with its expected status, the pending requests and
 * open connections are attached to the report as `netwatch-pending`.
 */
export const test = base.extend<NetwatchFixtures>({
  netwatch: [
    async ({ page }, use, testInfo) => {
      const tracker = new Netwatch(page);
      await use(tracker);
      if (testInfo.status !== testInfo.expectedStatus) {
        const pending = tracker.pending();
        const connections = tracker.openConnections();
        await testInfo.attach('netwatch-pending', {
          body: JSON.stringify({ pending, connections }, null, 2),
          contentType: 'application/json',
        });
        const lines = [
          `${pending.length} request(s) in flight, ${connections.length} connection(s) open`,
          '',
          'Pending requests:',
          ...(pending.length
            ? pending.map(
                (r) =>
                  `  ${r.method} ${r.url}  ${r.resourceType}  ${(r.elapsedMs / 1000).toFixed(1)}s in flight`,
              )
            : ['  (none)']),
          '',
          'Open connections:',
          ...(connections.length
            ? connections.map(
                (c) =>
                  `  ${c.type} ${c.url}  ${(c.elapsedMs / 1000).toFixed(1)}s open`,
              )
            : ['  (none)']),
        ];
        await testInfo.attach('netwatch-pending.txt', {
          body: lines.join('\n'),
          contentType: 'text/plain',
        });
      }
      tracker.dispose();
    },
    { auto: true },
  ],
});

export { expect };
