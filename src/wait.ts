import { errors } from '@playwright/test';
import type { Netwatch, PendingRequest } from './tracker.js';

export interface RequestFilter {
  url?: string | RegExp | ((url: string) => boolean);
  resourceType?: string | string[];
}

export interface WaitForRequestsOptions {
  /** Resolve once at most this many requests are in flight. Default 0. */
  below?: number;
  /** Required consecutive milliseconds under the threshold. Default 500. */
  idleMs?: number;
  /** Give up after this many milliseconds. Default 30000. 0 disables it. */
  timeout?: number;
  /** Requests matching the filter are not counted as in-flight. */
  filter?: RequestFilter | RequestFilter[];
}

function matchesUrl(
  url: string,
  pattern: NonNullable<RequestFilter['url']>,
): boolean {
  if (typeof pattern === 'string') return url.includes(pattern);
  if (pattern instanceof RegExp) return pattern.test(url);
  return pattern(url);
}

function matchesFilter(
  request: PendingRequest,
  filters: RequestFilter[],
): boolean {
  return filters.some((filter) => {
    const urlMatch =
      filter.url === undefined || matchesUrl(request.url, filter.url);
    if (!urlMatch) return false;
    if (filter.resourceType === undefined) return true;
    const types = Array.isArray(filter.resourceType)
      ? filter.resourceType
      : [filter.resourceType];
    return types.includes(request.resourceType);
  });
}

/**
 * Resolve once the tracker's in-flight request count stays at or below
 * `below` for `idleMs` consecutive milliseconds. Requests matching
 * `filter` are excluded from the count. Rejects with a TimeoutError
 * that lists the requests still in flight.
 */
export function waitForRequests(
  tracker: Netwatch,
  options: WaitForRequestsOptions = {},
): Promise<void> {
  const { below = 0, idleMs = 500, timeout = 30_000, filter } = options;
  const filters =
    filter === undefined ? [] : Array.isArray(filter) ? filter : [filter];
  const counts = (request: PendingRequest): boolean =>
    !matchesFilter(request, filters);

  return new Promise((resolve, reject) => {
    let idleTimer: ReturnType<typeof setTimeout> | undefined;
    let unsubscribe: () => void = () => {};
    let timeoutTimer: ReturnType<typeof setTimeout> | undefined;

    const cleanup = (): void => {
      if (timeoutTimer !== undefined) clearTimeout(timeoutTimer);
      if (idleTimer !== undefined) clearTimeout(idleTimer);
      unsubscribe();
    };

    const succeed = (): void => {
      cleanup();
      resolve();
    };

    const fail = (): void => {
      cleanup();
      const pending = tracker.pending().filter(counts);
      const details = pending
        .map(
          (r) =>
            `  ${r.method} ${r.url} (${(r.elapsedMs / 1000).toFixed(1)}s in flight)`,
        )
        .join('\n');
      reject(
        new errors.TimeoutError(
          `waitForRequests timed out after ${timeout}ms: ${pending.length} request(s) still in flight\n${details}`,
        ),
      );
    };

    const check = (): void => {
      if (tracker.pending().filter(counts).length <= below) {
        idleTimer ??= setTimeout(succeed, idleMs);
      } else if (idleTimer !== undefined) {
        clearTimeout(idleTimer);
        idleTimer = undefined;
      }
    };

    unsubscribe = tracker.onChange(check);
    // timeout <= 0 means no timeout, matching Playwright wait conventions.
    if (timeout > 0) timeoutTimer = setTimeout(fail, timeout);
    check();
  });
}
