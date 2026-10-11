// The HTTP surface: the SSE stream, controls, a debug snapshot, health and the
// built web app.
//
// Ported from reference/prototype/server.js.

import http, { type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { Feed } from '../feed/feed.js';
import { authorised, CHALLENGE } from './auth.js';
import { control, readBody } from './control.js';
import { serveStatic } from './static.js';
import { openStream } from './sse.js';

export interface ServerOptions {
  feed: Feed;
  appPassword: string;
  /** Directory holding the built web app. */
  publicDir: string;
}

function json(res: ServerResponse, code: number, body: unknown): void {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

export function createServer({ feed, appPassword, publicDir }: ServerOptions): Server {
  return http.createServer((req: IncomingMessage, res: ServerResponse) => {
    void (async () => {
      const url = new URL(req.url ?? '/', 'http://x');

      // Health sits outside the password, so Railway can reach it.
      if (url.pathname === '/healthz') return json(res, 200, { ok: true, mode: feed.mode });

      if (!authorised(req.headers.authorization, appPassword)) {
        res.writeHead(401, CHALLENGE);
        return res.end('Password required');
      }

      if (url.pathname === '/events') {
        return openStream(res, feed, (fn) => req.on('close', fn));
      }

      if (url.pathname === '/api/control' && req.method === 'POST') {
        try {
          return json(res, 200, await control(feed, await readBody(req)));
        } catch (e) {
          return json(res, 400, { error: e instanceof Error ? e.message : String(e) });
        }
      }

      if (url.pathname === '/api/state') return json(res, 200, feed.helloPayload());

      return serveStatic(res, publicDir, url.pathname);
    })();
  });
}
