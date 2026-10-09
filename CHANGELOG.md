# Changelog

## Unreleased

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
