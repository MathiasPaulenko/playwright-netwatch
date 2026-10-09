import type { Page, Request, WebSocket } from '@playwright/test';

export type RequestOutcome = 'pending' | 'finished' | 'failed';

export interface RequestRecord {
  url: string;
  method: string;
  resourceType: string;
  outcome: RequestOutcome;
  startedAt: number;
  durationMs?: number;
  failure?: string;
}

export interface PendingRequest {
  url: string;
  method: string;
  resourceType: string;
  startedAt: number;
  elapsedMs: number;
}

export interface OpenConnection {
  type: 'websocket';
  url: string;
  openedAt: number;
  elapsedMs: number;
}

interface RequestEntry {
  url: string;
  method: string;
  resourceType: string;
  outcome: 'pending' | 'finished' | 'failed';
  startedAt: number;
  durationMs?: number;
  failure?: string;
}

interface SocketEntry {
  url: string;
  openedAt: number;
}

/**
 * Passive network observer for a Playwright page. Tracks in-flight
 * requests, request history and live websockets. No interception.
 */
export class Netwatch {
  private readonly requests = new Map<Request, RequestEntry>();
  private readonly sockets = new Set<WebSocket>();
  private readonly socketMeta = new Map<WebSocket, SocketEntry>();
  private disposed = false;

  private readonly onRequest = (request: Request): void => {
    this.requests.set(request, {
      url: request.url(),
      method: request.method(),
      resourceType: request.resourceType(),
      outcome: 'pending',
      startedAt: Date.now(),
    });
  };

  private readonly onRequestFinished = (request: Request): void => {
    const entry = this.requests.get(request);
    if (!entry) return;
    entry.outcome = 'finished';
    entry.durationMs = Date.now() - entry.startedAt;
  };

  private readonly onRequestFailed = (request: Request): void => {
    const entry = this.requests.get(request);
    if (!entry) return;
    entry.outcome = 'failed';
    entry.durationMs = Date.now() - entry.startedAt;
    entry.failure = request.failure()?.errorText;
  };

  private readonly onWebSocket = (ws: WebSocket): void => {
    this.sockets.add(ws);
    this.socketMeta.set(ws, { url: ws.url(), openedAt: Date.now() });
    ws.on('close', () => {
      this.sockets.delete(ws);
      this.socketMeta.delete(ws);
    });
  };

  constructor(private readonly page: Page) {
    page.on('request', this.onRequest);
    page.on('requestfinished', this.onRequestFinished);
    page.on('requestfailed', this.onRequestFailed);
    page.on('websocket', this.onWebSocket);
  }

  /** Requests currently in flight. */
  pending(): PendingRequest[] {
    const now = Date.now();
    const out: PendingRequest[] = [];
    for (const entry of this.requests.values()) {
      if (entry.outcome !== 'pending') continue;
      out.push({
        url: entry.url,
        method: entry.method,
        resourceType: entry.resourceType,
        startedAt: entry.startedAt,
        elapsedMs: now - entry.startedAt,
      });
    }
    return out;
  }

  /** Persistent connections currently open (websockets). */
  openConnections(): OpenConnection[] {
    const now = Date.now();
    const out: OpenConnection[] = [];
    for (const ws of this.sockets) {
      if (ws.isClosed()) continue;
      const meta = this.socketMeta.get(ws);
      if (!meta) continue;
      out.push({ type: 'websocket', ...meta, elapsedMs: now - meta.openedAt });
    }
    return out;
  }

  /** Every request observed so far, including ones still in flight. */
  history(): RequestRecord[] {
    return [...this.requests.values()].map((entry) => ({ ...entry }));
  }

  /** Detach all listeners from the page. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.page.off('request', this.onRequest);
    this.page.off('requestfinished', this.onRequestFinished);
    this.page.off('requestfailed', this.onRequestFailed);
    this.page.off('websocket', this.onWebSocket);
  }
}
