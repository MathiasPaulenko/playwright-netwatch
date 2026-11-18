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
  if (pattern instanceof RegExp) {
    // 'g'/'y' flags make .test() stateful via lastIndex — reset for
    // deterministic results across repeated polls.
    pattern.lastIndex = 0;
    return pattern.test(record.url);
  }
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
    const tracker = received as Partial<Netwatch> | null | undefined;
    if (tracker == null || typeof tracker.history !== 'function') {
      throw new TypeError('toHaveRequested must be used on a Netwatch tracker');
    }
    if (
      typeof urlOrPattern !== 'string' &&
      !(urlOrPattern instanceof RegExp) &&
      typeof urlOrPattern !== 'function'
    ) {
      throw new TypeError(
        'toHaveRequested expects a string, RegExp or predicate as the url pattern',
      );
    }
    const { method, status } = options ?? {};
    if (method !== undefined && typeof method !== 'string') {
      throw new TypeError(`toHaveRequested: 'method' must be a string`);
    }
    if (status !== undefined && typeof status !== 'number') {
      throw new TypeError(`toHaveRequested: 'status' must be a number`);
    }
    const timeout = options?.timeout ?? this.timeout ?? 5000;
    if (typeof timeout !== 'number' || Number.isNaN(timeout))
      throw new RangeError(
        `toHaveRequested: 'timeout' must be a number, got ${timeout}`,
      );
    const deadline = Date.now() + timeout;

    const matches = (record: RequestRecord): boolean =>
      matchesUrl(record, urlOrPattern) &&
      (method === undefined ||
        record.method.toUpperCase() === method.toUpperCase()) &&
      (status === undefined || record.status === status);

    let matched: RequestRecord | undefined = tracker.history().find(matches);
    while (!matched && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 100));
      matched = tracker.history().find(matches);
    }
    // One last read so a request landing just before the deadline isn't missed.
    matched ??= tracker.history().find(matches);
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
