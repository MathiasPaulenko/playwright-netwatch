import { expect as baseExpect } from '@playwright/test';
import type { Netwatch, RequestRecord } from './tracker.js';

export type UrlPattern = string | RegExp | ((record: RequestRecord) => boolean);

export interface ToHaveRequestedOptions {
  /** Required HTTP method (e.g. 'POST'). Any method matches by default. */
  method?: string;
  /** Give up polling after this many milliseconds. Default 5000. */
  timeout?: number;
}

function matchesUrl(record: RequestRecord, pattern: UrlPattern): boolean {
  if (typeof pattern === 'string') return record.url.includes(pattern);
  if (pattern instanceof RegExp) return pattern.test(record.url);
  return pattern(record);
}

function describe(pattern: UrlPattern): string {
  if (typeof pattern === 'string') return `"${pattern}"`;
  if (pattern instanceof RegExp) return String(pattern);
  return 'the given predicate';
}

/**
 * Playwright `expect` extended with `toHaveRequested`, a retried
 * assertion over a Netwatch tracker. Resolves as soon as a matching
 * request (completed or still in flight) has been observed.
 */
export const expect = baseExpect.extend({
  async toHaveRequested(
    this: { isNot: boolean },
    received: Netwatch,
    urlOrPattern: UrlPattern,
    options: ToHaveRequestedOptions = {},
  ): Promise<{ pass: boolean; name: string; message: () => string }> {
    const { method, timeout = 5000 } = options;
    const deadline = Date.now() + timeout;

    const matches = (record: RequestRecord): boolean =>
      matchesUrl(record, urlOrPattern) &&
      (method === undefined || record.method === method);

    let pass = received.history().some(matches);
    while (!pass && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 100));
      pass = received.history().some(matches);
    }

    const wanted = `${method ? `${method} ` : ''}${describe(urlOrPattern)}`;
    const message = (): string => {
      const seen = received
        .history()
        .map((r) => `  ${r.method} ${r.url} [${r.outcome}]`)
        .join('\n');
      return `expected netwatch ${
        this.isNot ? 'not ' : ''
      }to have requested ${wanted} within ${timeout}ms.\nRequests seen:\n${
        seen || '  (none)'
      }`;
    };

    return { pass, name: 'toHaveRequested', message };
  },
});

declare global {
  export namespace PlaywrightTest {
    export interface Matchers<R, T = unknown> {
      toHaveRequested(
        urlOrPattern: UrlPattern,
        options?: ToHaveRequestedOptions,
      ): Promise<R>;
    }
  }
}
