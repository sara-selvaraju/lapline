// The HTTP surface: the SSE stream, controls, a debug snapshot, health and the
// built web app.
//
// Ported from reference/prototype/server.js.

import http, { type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { Feed } from '../feed/feed.js';
import {
  Attempts,
  authorised,
  loginPage,
  mintCookie,
  readForm,
  safeEqual,
  setCookieHeader,
  signingKey,
  WRONG_DELAY_MS,
} from './auth.js';
import { control, readBody } from './control.js';
import { crossingsPayload, periodsPayload } from './query.js';
import { serveStatic } from './static.js';
import { openStream } from './sse.js';

export interface ServerOptions {
  feed: Feed;
  appPassword: string;
  /** Signs the session cookie; falls back to the password when unset. */
  sessionSecret: string;
  /** Directory holding the built web app. */
  publicDir: string;
}

/** Whether the connection reaching the browser is https, proxy included. */
function isSecure(req: IncomingMessage): boolean {
  const proto = (req.headers['x-forwarded-proto'] as string | undefined) ?? '';
  return proto.split(',')[0]?.trim() === 'https';
}

function json(res: ServerResponse, code: number, body: unknown): void {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

export function createServer({ feed, appPassword, sessionSecret, publicDir }: ServerOptions): Server {
  const key = signingKey(sessionSecret, appPassword);
  const attempts = new Attempts();

  return http.createServer((req: IncomingMessage, res: ServerResponse) => {
    void (async () => {
      const url = new URL(req.url ?? '/', 'http://x');

      // Health sits outside the password, so Railway can reach it.
      if (url.pathname === '/healthz') return json(res, 200, { ok: true, mode: feed.mode });

      // The way in has to sit outside the gate, or there is no way in.
      if (url.pathname === '/login') {
        if (!appPassword) {
          res.writeHead(302, { Location: '/' });
          return res.end();
        }
        // Behind Railway's proxy the socket address is the proxy, so the
        // forwarded address is what distinguishes one phone from another.
        const who =
          (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() ||
          req.socket.remoteAddress ||
          'unknown';

        if (req.method === 'POST') {
          const locked = attempts.lockedFor(who);
          if (locked != null) {
            res.writeHead(429, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
            return res.end(loginPage(`Too many attempts. Try again in ${Math.ceil(locked / 60_000)} minutes.`));
          }

          const given = new URLSearchParams(await readForm(req)).get('password') ?? '';
          if (safeEqual(given, appPassword)) {
            attempts.right(who);
            res.writeHead(302, {
              Location: '/',
              'Set-Cookie': setCookieHeader(mintCookie(key), isSecure(req)),
            });
            return res.end();
          }

          attempts.wrong(who);
          await new Promise((r) => setTimeout(r, WRONG_DELAY_MS));
          res.writeHead(401, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
          return res.end(loginPage('That password was not right.'));
        }

        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
        return res.end(loginPage());
      }

      if (!authorised(req.headers.cookie, appPassword, key)) {
        // A page request gets the form; anything else gets a plain 401, so a
        // stale tab's fetch does not quietly render HTML into a JSON parser.
        if (req.method === 'GET' && (req.headers.accept ?? '').includes('text/html')) {
          res.writeHead(302, { Location: '/login' });
          return res.end();
        }
        res.writeHead(401, { 'Content-Type': 'text/plain' });
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

      if (url.pathname === '/api/crossings') {
        const since = Number(url.searchParams.get('since')) || 0;
        return json(res, 200, crossingsPayload(feed, since));
      }

      if (url.pathname === '/api/periods') return json(res, 200, periodsPayload(feed));

      if (url.pathname === '/api/state') return json(res, 200, feed.helloPayload());

      return serveStatic(res, publicDir, url.pathname);
    })();
  });
}
