# Changelog

## Unreleased

## 1.1.2 — 2026-11-18

### Fixed

- `RegExp` patterns with `g`/`y` flags no longer match non-deterministically in `waitForRequests` filters and `toHaveRequested` — `lastIndex` is reset before each evaluation.
- `waitForRequests({ timeout: Infinity })` no longer fails instantly (`setTimeout` overflow clamp); non-finite timeouts now disable the timeout. `timeout: NaN`, non-numeric timeouts, negative `below`/`idleMs` and non-object filters throw `RangeError`/`TypeError` instead of hanging or silently ignoring all traffic.
- `toHaveRequested` throws a clear `TypeError` when used on a non-Netwatch value or with an invalid url pattern, validates `method`/`status`/`timeout` types, and no longer misses a request arriving right at the deadline.
- `Netwatch.onChange` runs every listener even when one throws (the first error is rethrown afterwards), so a bad subscriber can't silently break `waitForRequests`.
- `Netwatch.dispose()` clears change listeners; the fixture also disposes the tracker when report attachment fails.
- `request.timing()` failures no longer propagate into Playwright's event dispatch; `history()` returns a copy of `timing` so callers can't mutate tracker state.
- `pending()` stays O(in-flight) on pages with large request history.
- Test server teardown kills sockets on Node <18.2 (no `closeAllConnections` dependency).

## 1.1.0 — 2026-10-09

### Added

- `RequestRecord.status` (HTTP status once response headers arrive) and `RequestRecord.timing` (Playwright timing breakdown) in `history()`. `PendingRequest` also exposes `status` — headers can arrive while the body is still streaming.
- `toHaveRequested` accepts a `status` option: `expect(netwatch).toHaveRequested('/api/login', { status: 200 })`.
- New `netwatch-pending.txt` attachment on test failure — a readable text summary alongside the existing JSON dump.
- `test` workflow runs typecheck, tests and build on pushes to `master` and pull requests.

## 1.0.0 — 2026-10-09

First public release.

- `Netwatch` tracker: `pending()`, `openConnections()`, `history()`, `stats()`, `onChange()`, `dispose()`.
- Automatic `netwatch` fixture — attaches `netwatch-pending` (JSON dump of in-flight requests and open websockets) when a test fails or times out.
- `waitForRequests({ below, idleMs, timeout, filter })` — granular network-idle wait that tolerates persistent traffic.
- `toHaveRequested(urlOrPattern, { method, timeout })` matcher on the package's `expect`.
