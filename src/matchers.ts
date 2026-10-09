import { expect as baseExpect } from '@playwright/test';
import type { ExpectMatcherState } from '@playwright/test';
import type { Netwatch, RequestRecord } from './tracker.js';

export type UrlPattern = string | RegExp | ((record: RequestRecord) => boolean);

export interface ToHaveRequestedOptions {
  /** Required HTTP method, case-insensitive (e.g. 'POST'). Any method matches by default. */
  method?: string;
  /** Required response status code (e.g. 200). Any status matches by default. */
  status?: number;
  /** Give up polling after this many milliseconds. Defaults to the expect timeout. */
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
    this: ExpectMatcherState,
    received: Netwatch,
    urlOrPattern: UrlPattern,
    options: ToHaveRequestedOptions = {},
  ): Promise<{ pass: boolean; name: string; message: () => string }> {
    const { method, status } = options;
    const timeout = options.timeout ?? this.timeout ?? 5000;
    const deadline = Date.now() + timeout;

    const matches = (record: RequestRecord): boolean =>
      matchesUrl(record, urlOrPattern) &&
      (method === undefined ||
        record.method.toUpperCase() === method.toUpperCase()) &&
      (status === undefined || record.status === status);

    let matched: RequestRecord | undefined = received.history().find(matches);
    while (!matched && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 100));
      matched = received.history().find(matches);
    }
    const pass = matched !== undefined;

    const wanted = `${method ? `${method} ` : ''}${describe(urlOrPattern)}${
      status !== undefined ? ` with status ${status}` : ''
    }`;
    const formatRecord = (r: RequestRecord): string =>
      `  ${r.method} ${r.url} [${r.outcome}${
        r.status !== undefined ? ` ${r.status}` : ''
      }]`;
    const message = (): string => {
      if (this.isNot && matched) {
        return `expected netwatch not to have requested ${wanted}, but it matched:\n${formatRecord(matched)}`;
      }
      const seen = received.history().map(formatRecord).join('\n');
      return `expected netwatch to have requested ${wanted} within ${timeout}ms.\nRequests seen:\n${
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
