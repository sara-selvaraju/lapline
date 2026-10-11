// Serving the built web app.
//
// Hashed assets get a long cache; everything else is no-cache, as the prototype
// had it. Vite emits content-hashed filenames, so /assets/ is safe to pin
// forever and index.html must never be.

import fs from 'node:fs';
import path from 'node:path';
import type { ServerResponse } from 'node:http';

export const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

/**
 * Resolves a request path inside the public root, or null if it escapes.
 *
 * The prototype compared the joined path with `startsWith(PUBLIC)`, which also
 * accepts a sibling directory whose name merely begins with the root's — for
 * example `/app/public` would admit `/app/public-ssr/secret`. That was
 * unreachable in the prototype because no such sibling existed, but this serves
 * apps/web/dist, where a sibling build directory is plausible. path.relative
 * cannot be fooled that way.
 */
export function resolveStatic(root: string, urlPath: string): string | null {
  const p = urlPath === '/' ? '/index.html' : urlPath;
  const file = path.normalize(path.join(root, decodeURIComponent(p)));
  const rel = path.relative(root, file);
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return file;
}

/** Content-hashed assets never change under the same name. */
export function cacheControlFor(file: string): string {
  return /[./]assets[/\\]/.test(file) ? 'public, max-age=31536000, immutable' : 'no-cache';
}

export function serveStatic(res: ServerResponse, root: string, urlPath: string): void {
  const file = resolveStatic(root, urlPath);
  if (!file) {
    res.writeHead(403);
    res.end();
    return;
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': cacheControlFor(file),
    });
    res.end(data);
  });
}
