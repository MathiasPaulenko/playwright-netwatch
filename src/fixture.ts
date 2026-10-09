import { test as base, expect } from '@playwright/test';
import { Netwatch } from './tracker.js';

export interface NetwatchFixtures {
  netwatch: Netwatch;
}

/**
 * Extended `test` with a `netwatch` fixture. When the test does not
 * finish with its expected status, the pending requests and open
 * connections are attached to the report as `netwatch-pending`.
 */
export const test = base.extend<NetwatchFixtures>({
  netwatch: async ({ page }, use, testInfo) => {
    const tracker = new Netwatch(page);
    await use(tracker);
    if (testInfo.status !== testInfo.expectedStatus) {
      await testInfo.attach('netwatch-pending', {
        body: JSON.stringify(
          {
            pending: tracker.pending(),
            connections: tracker.openConnections(),
          },
          null,
          2,
        ),
        contentType: 'application/json',
      });
    }
    tracker.dispose();
  },
});

export { expect };
