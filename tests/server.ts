import { createHash } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Duplex } from 'node:stream';

export interface TestServer {
  url: string;
  wsUrl: string;
  close(): Promise<void>;
}

/**
 * Minimal HTTP/WS server for exercising the tracker.
 * /ok responds immediately, /slow?ms=N after a delay, /hang never,
 * /sse streams forever, /ws completes the websocket handshake.
 */
export async function startServer(): Promise<TestServer> {
  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    switch (url.pathname) {
      case '/ok':
        res.end('ok');
        return;
      case '/slow': {
        const ms = Number(url.searchParams.get('ms') ?? '500');
        setTimeout(() => res.end('slow'), ms);
        return;
      }
      case '/hang':
        return;
      case '/sse': {
        res.writeHead(200, {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache',
        });
        res.write('data: open\n\n');
        const timer = setInterval(() => res.write('data: tick\n\n'), 1000);
        req.on('close', () => clearInterval(timer));
        return;
      }
      default:
        res.writeHead(404);
        res.end();
    }
  });

  const upgraded = new Set<Duplex>();

  server.on('upgrade', (req, socket) => {
    if (!req.url?.startsWith('/ws')) {
      socket.destroy();
      return;
    }
    const key = req.headers['sec-websocket-key'] ?? '';
    const accept = createHash('sha1')
      .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
      .digest('base64');
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
        'Upgrade: websocket\r\n' +
        'Connection: Upgrade\r\n' +
        `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
    );
    upgraded.add(socket);
    socket.on('close', () => upgraded.delete(socket));
    socket.on('data', (frame) => {
      // Answer close frames so the browser sees a clean websocket shutdown.
      if ((frame[0] & 0x0f) === 0x8) {
        socket.write(Buffer.from([0x88, 0x00]));
        socket.end();
      }
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}`,
    wsUrl: `ws://127.0.0.1:${port}`,
    close: () =>
      new Promise((resolve, reject) => {
        for (const socket of upgraded) socket.destroy();
        server.closeAllConnections();
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}
