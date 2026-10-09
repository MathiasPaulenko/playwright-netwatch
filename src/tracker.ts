import type { Page, Request, WebSocket } from '@playwright/test';
import { waitForRequests, type WaitForRequestsOptions } from './wait.js';

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

interface SocketEntry {
  url: string;
  openedAt: number;
}

/**
 * Passive network observer for a Playwright page. Tracks in-flight
 * requests, request history and live websockets. No interception.
 */
export class Netwatch {
  private readonly requests = new Map<Request, RequestRecord>();
  private readonly socketMeta = new Map<WebSocket, SocketEntry>();
  private readonly listeners = new Set<() => void>();
  private disposed = false;

  private emitChange(): void {
    for (const listener of this.listeners) listener();
  }

  private readonly onRequest = (request: Request): void => {
    this.requests.set(request, {
      url: request.url(),
      method: request.method(),
      resourceType: request.resourceType(),
      outcome: 'pending',
      startedAt: Date.now(),
    });
    this.emitChange();
  };

  private readonly onRequestFinished = (request: Request): void => {
    const entry = this.requests.get(request);
    if (!entry) return;
    entry.outcome = 'finished';
    entry.durationMs = Date.now() - entry.startedAt;
    this.emitChange();
  };

  private readonly onRequestFailed = (request: Request): void => {
    const entry = this.requests.get(request);
    if (!entry) return;
    entry.outcome = 'failed';
    entry.durationMs = Date.now() - entry.startedAt;
    entry.failure = request.failure()?.errorText;
    this.emitChange();
  };

  private readonly onWebSocket = (ws: WebSocket): void => {
    this.socketMeta.set(ws, { url: ws.url(), openedAt: Date.now() });
    ws.on('close', () => {
      this.socketMeta.delete(ws);
      this.emitChange();
    });
    this.emitChange();
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
    for (const [ws, meta] of this.socketMeta) {
      if (ws.isClosed()) {
        this.socketMeta.delete(ws);
        continue;
      }
      out.push({ type: 'websocket', ...meta, elapsedMs: now - meta.openedAt });
    }
    return out;
  }

  /** Every request observed so far, including ones still in flight. */
  history(): RequestRecord[] {
    return [...this.requests.values()].map((entry) => ({ ...entry }));
  }

  /**
   * Resolve once in-flight requests stay at or below `below` for
   * `idleMs` consecutive milliseconds. See {@link WaitForRequestsOptions}.
   */
  waitForRequests(options?: WaitForRequestsOptions): Promise<void> {
    return waitForRequests(this, options);
  }

  /**
   * Subscribe to network state changes (requests started, finished,
   * failed, sockets opened or closed). Returns an unsubscribe function.
   */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
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
