import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { test, expect } from '@playwright/test';

const playwrightCli = createRequire(import.meta.url).resolve('@playwright/test/cli');

interface Attachment {
  name: string;
  contentType: string;
  body?: string;
}

interface SpecResult {
  title: string;
  ok: boolean;
  attachments: Attachment[];
}

function collectSpecs(node: unknown, out: SpecResult[]): void {
  if (Array.isArray(node)) {
    for (const item of node) collectSpecs(item, out);
    return;
  }
  if (!node || typeof node !== 'object') return;
  const record = node as Record<string, unknown>;
  if (typeof record.title === 'string' && Array.isArray(record.tests)) {
    const tests = record.tests as Record<string, unknown>[];
    out.push({
      title: record.title,
      ok: record.ok === true,
      attachments: tests.flatMap((t) =>
        (t.results as Record<string, unknown>[]).flatMap(
          (r) => (r.attachments ?? []) as Attachment[],
        ),
      ),
    });
    return;
  }
  for (const value of Object.values(record)) collectSpecs(value, out);
}

async function runFixtureSpecs(): Promise<{ code: number; specs: SpecResult[] }> {
  const { code, stdout } = await new Promise<{ code: number; stdout: string }>(
    (resolve) => {
      execFile(
        process.execPath,
        [
          playwrightCli,
          'test',
          '--config',
          'tests/fixtures/playwright.config.ts',
          '--reporter=json',
        ],
        { cwd: process.cwd(), maxBuffer: 16 * 1024 * 1024 },
        (error, stdout) =>
          resolve({
            code: error ? (error.code as number) : 0,
            stdout: String(stdout),
          }),
      );
    },
  );
  const specs: SpecResult[] = [];
  collectSpecs(JSON.parse(stdout), specs);
  return { code, specs };
}

test('attaches netwatch-pending dump only when a test fails', async () => {
  test.setTimeout(120_000);

  const { code, specs } = await runFixtureSpecs();
  expect(code).not.toBe(0);

  const failing = specs.find((s) => s.title.includes('hanging request'));
  const passing = specs.find((s) => s.title.includes('quiet network'));
  expect(failing).toBeDefined();
  expect(passing).toBeDefined();

  const dump = failing?.attachments.find((a) => a.name === 'netwatch-pending');
  expect(dump).toBeDefined();
  expect(dump?.contentType).toBe('application/json');

  const body = JSON.parse(
    Buffer.from(dump?.body ?? '', 'base64').toString('utf8'),
  ) as {
    pending?: { url: string }[];
    connections?: { type: string; url: string }[];
  };
  expect(body.pending?.some((r) => r.url.includes('/hang'))).toBe(true);
  expect(
    body.connections?.some((c) => c.type === 'websocket' && c.url.includes('/ws')),
  ).toBe(true);

  expect(passing?.attachments.some((a) => a.name === 'netwatch-pending')).toBe(
    false,
  );
});
