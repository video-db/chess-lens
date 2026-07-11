import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { trpcServer } from '@hono/trpc-server';
import { serve } from '@hono/node-server';
import { existsSync, readFileSync } from 'fs';
import path from 'path';
import { appRouter } from './trpc/router';
import { createContext } from './trpc/context';
import { createChildLogger } from '../lib/logger';

const logger = createChildLogger('http-server');

let server: ReturnType<typeof serve> | null = null;

const rendererDir = path.join(__dirname, '..', '..', 'renderer');
const rendererIndex = path.join(rendererDir, 'index.html');

function getContentType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();

  switch (ext) {
    case '.html':
      return 'text/html; charset=utf-8';
    case '.js':
      return 'text/javascript; charset=utf-8';
    case '.css':
      return 'text/css; charset=utf-8';
    case '.json':
      return 'application/json; charset=utf-8';
    case '.svg':
      return 'image/svg+xml';
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.ico':
      return 'image/x-icon';
    case '.woff':
      return 'font/woff';
    case '.woff2':
      return 'font/woff2';
    default:
      return 'application/octet-stream';
  }
}

function sendRendererFile(filePath: string): Response {
  const body = readFileSync(filePath);
  return new Response(body, {
    headers: {
      'Content-Type': getContentType(filePath),
    },
  });
}

function resolveRendererAsset(requestPath: string): string | null {
  const relativePath = requestPath.replace(/^\/+/, '');
  const resolvedPath = path.resolve(rendererDir, relativePath);

  if (!resolvedPath.startsWith(path.resolve(rendererDir) + path.sep)) {
    return null;
  }

  return existsSync(resolvedPath) ? resolvedPath : null;
}

function rendererIndexAvailable(): boolean {
  return existsSync(rendererIndex);
}

export function createServer() {
  const app = new Hono();

  // CORS middleware
  app.use(
    '*',
    cors({
      origin: '*',
      allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'x-access-token'],
    })
  );

  app.get('/assets/*', (c) => {
    const assetPath = resolveRendererAsset(c.req.path);

    if (!assetPath) {
      return c.text('Not found', 404);
    }

    return sendRendererFile(assetPath);
  });

  // Health check
  app.get('/api', (c) => {
    return c.json({
      status: 'ok',
      message: 'Chess Lens Server Running',
    });
  });

  // tRPC handler
  app.use(
    '/api/trpc/*',
    trpcServer({
      router: appRouter,
      endpoint: '/api/trpc',
      createContext: async (_opts, c) => createContext(c),
    })
  );

  app.get('*', (c) => {
    if (rendererIndexAvailable()) {
      return sendRendererFile(rendererIndex);
    }

    return c.html(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Chess Lens API</title>
    <style>
      body { font-family: system-ui, sans-serif; margin: 2rem; color: #171717; }
      code { background: #f4f4f5; border-radius: 4px; padding: 0.125rem 0.25rem; }
    </style>
  </head>
  <body>
    <h1>Chess Lens API is running</h1>
    <p>This local server handles API requests for the Electron desktop app.</p>
    <p>Health check: <code>/api</code>. Renderer dev server: <code>npm run dev:renderer</code>.</p>
  </body>
</html>`);
  });

  return app;
}

let currentPort: number | undefined;

export async function startServer(port: number, maxRetries: number = 10): Promise<number> {
  if (server) {
    logger.warn('Server already running');
    return currentPort || port;
  }

  const app = createServer();

  const tryPort = (attemptPort: number, retriesLeft: number): Promise<number> => {
    return new Promise((resolve, reject) => {
      const serverInstance = serve(
        {
          fetch: app.fetch,
          port: attemptPort,
        },
        (info) => {
          server = serverInstance;
          currentPort = info.port;
          logger.info({ port: info.port }, 'HTTP server started');
          resolve(info.port);
        }
      );

      // Handle errors (like EADDRINUSE)
      serverInstance.on('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE' && retriesLeft > 0) {
          logger.warn({ port: attemptPort }, 'Port in use, trying next port');
          serverInstance.close();
          resolve(tryPort(attemptPort + 1, retriesLeft - 1));
        } else {
          reject(err);
        }
      });
    });
  };

  return tryPort(port, maxRetries);
}

export async function stopServer(): Promise<void> {
  if (server) {
    logger.info('Stopping HTTP server');
    server.close();
    server = null;
  }
}

export function getServerStatus(): { running: boolean; port?: number } {
  return {
    running: !!server,
    port: currentPort,
  };
}
