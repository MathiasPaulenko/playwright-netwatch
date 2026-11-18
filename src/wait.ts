import { errors } from '@playwright/test';
import type { Netwatch, PendingRequest } from './tracker.js';

export interface RequestFilter {
  /** Substring, RegExp or predicate over the request URL. */
  url?: string | RegExp | ((url: string) => boolean);
  /** Playwright resource type(s), e.g. 'fetch', 'eventsource'. */
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
  if (pattern instanceof RegExp) {
    // 'g'/'y' flags make .test() stateful via lastIndex — reset for
    // deterministic results across repeated evaluations.
    pattern.lastIndex = 0;
    return pattern.test(url);
  }
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
 * `below` for `idleMs` consecutive milliseconds, with the requests still
 * counted as in flight. Requests matching `filter` are excluded from
 * the count. Rejects with a TimeoutError that lists them.
 */
export function waitForRequests(
  tracker: Netwatch,
  options: WaitForRequestsOptions = {},
): Promise<PendingRequest[]> {
  const {
    below = 0,
    idleMs = 500,
    timeout = 30_000,
    filter,
  } = options ?? {};
  if (!Number.isFinite(below) || below < 0)
    throw new RangeError(
      `waitForRequests: 'below' must be a number >= 0, got ${below}`,
    );
  if (!Number.isFinite(idleMs) || idleMs < 0)
    throw new RangeError(
      `waitForRequests: 'idleMs' must be a number >= 0, got ${idleMs}`,
    );
  if (typeof timeout !== 'number' || Number.isNaN(timeout))
    throw new RangeError(
      `waitForRequests: 'timeout' must be a number, got ${timeout}`,
    );
  const filters =
    filter === undefined ? [] : Array.isArray(filter) ? filter : [filter];
  for (const entry of filters) {
    if (
      entry === null ||
      typeof entry !== 'object' ||
      Array.isArray(entry) ||
      entry instanceof RegExp
    ) {
      throw new TypeError(
        'waitForRequests: each filter must be an object like { url, resourceType }',
      );
    }
    if (
      entry.url !== undefined &&
      typeof entry.url !== 'string' &&
      !(entry.url instanceof RegExp) &&
      typeof entry.url !== 'function'
    ) {
      throw new TypeError(
        "waitForRequests: filter 'url' must be a string, RegExp or predicate",
      );
    }
    if (
      entry.resourceType !== undefined &&
      typeof entry.resourceType !== 'string' &&
      !Array.isArray(entry.resourceType)
    ) {
      throw new TypeError(
        "waitForRequests: filter 'resourceType' must be a string or list of strings",
      );
    }
  }
  const counts = (request: PendingRequest): boolean =>
    !matchesFilter(request, filters);

  return new Promise<PendingRequest[]>((resolve, reject) => {
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
      resolve(tracker.pending().filter(counts));
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
    // timeout <= 0 or non-finite means no timeout, matching Playwright wait
    // conventions — Infinity would clamp setTimeout to ~1ms and fire instantly.
    if (timeout > 0 && Number.isFinite(timeout))
      timeoutTimer = setTimeout(fail, timeout);
    check();
  });
}
