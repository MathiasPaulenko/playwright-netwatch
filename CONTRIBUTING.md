# Contributing

Thanks for considering a contribution. This is a small, focused library — keep it that way.

## Scope

netwatch is **passive network observation** for Playwright tests. It never intercepts, mocks, or throttles traffic. Features that control the network belong to `page.route` or other tools — requests for them will be declined.

In scope: better pending-request diagnostics, network-idle waits, request assertions, websockets/SSE visibility.

## Setup

```bash
npm install
npx playwright install chromium   # bundled chromium; on restricted machines use channel: 'chrome'
npm run build                     # tsup → dist/ (esm + cjs + dts)
npm test                          # playwright test
npm run typecheck                 # tsc --noEmit
```

Tests run against a real browser and a local `http.createServer` fixture (see `tests/server.ts`). `tests/unit.spec.ts` runs the same logic without a browser.

## Rules

- TypeScript strict — no `any` without a good reason, explicit types on public exports.
- Write tests first when you can; the suite must stay green (`npm test`, `npm run typecheck`, `npm run build`).
- Conventional Commits, atomic, in English (`feat:`, `fix:`, `test:`, `docs:`, `chore:`).
- Comments only where the *why* isn't obvious. No narration.
- Keep dependencies at zero — `@playwright/test` is the only allowed dependency, and it stays a `peerDependency`.

## Pull requests

Open an issue first for anything beyond a bugfix — scope discussions are cheaper than rejected PRs. Include a test that fails without your change and passes with it.
