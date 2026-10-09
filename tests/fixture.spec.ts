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

interface DumpBody {
  pending?: {
    url: string;
    method: string;
    resourceType: string;
    elapsedMs: number;
  }[];
  connections?: { type: string; url: string }[];
}

function dumpBody(spec: SpecResult): DumpBody | undefined {
  const dump = spec.attachments.find((a) => a.name === 'netwatch-pending');
  if (!dump?.body) return undefined;
  return JSON.parse(
    Buffer.from(dump.body, 'base64').toString('utf8'),
  ) as DumpBody;
}

test('attaches netwatch-pending dump only when a test fails', async () => {
  test.setTimeout(120_000);

  const { code, specs } = await runFixtureSpecs();
  expect(code).not.toBe(0);

  const failing = specs.find((s) => s.title.includes('hanging request'));
  const timedOut = specs.find((s) => s.title.includes('dies on timeout'));
  const passing = specs.find((s) => s.title.includes('quiet network'));
  expect(failing).toBeDefined();
  expect(timedOut).toBeDefined();
  expect(passing).toBeDefined();

  const body = dumpBody(failing!);
  expect(body).toBeDefined();
  const hung = body?.pending?.find((r) => r.url.includes('/hang'));
  expect(hung).toBeDefined();
  expect(hung?.method).toBe('GET');
  expect(hung?.resourceType).toBe('fetch');
  expect(hung?.elapsedMs).toBeGreaterThanOrEqual(0);
  expect(
    body?.connections?.some(
      (c) => c.type === 'websocket' && c.url.includes('/ws'),
    ),
  ).toBe(true);

  const textDump = failing!.attachments.find(
    (a) => a.name === 'netwatch-pending.txt',
  );
  expect(textDump?.contentType).toBe('text/plain');
  const text = Buffer.from(textDump?.body ?? '', 'base64').toString('utf8');
  expect(text).toContain('/hang');
  expect(text).toContain('websocket');

  // the headline case: a test that dies on timeout gets the same dump
  const timedOutBody = dumpBody(timedOut!);
  expect(timedOut!.ok).toBe(false);
  expect(
    timedOutBody?.pending?.some((r) => r.url.includes('/hang')),
  ).toBe(true);

  expect(passing?.attachments.some((a) => a.name === 'netwatch-pending')).toBe(
    false,
  );
});
