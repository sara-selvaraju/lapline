import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { cacheControlFor, resolveStatic, TYPES } from '../src/http/static.js';

const ROOT = '/srv/app/web/dist';

describe('resolveStatic', () => {
  it('serves index.html for the root path', () => {
    expect(resolveStatic(ROOT, '/')).toBe(path.join(ROOT, 'index.html'));
  });

  it('resolves a file inside the root', () => {
    expect(resolveStatic(ROOT, '/assets/index-abc123.js')).toBe(path.join(ROOT, 'assets/index-abc123.js'));
  });

  it('refuses a path that climbs out of the root', () => {
    expect(resolveStatic(ROOT, '/../../etc/passwd')).toBeNull();
    expect(resolveStatic(ROOT, '/../server/dist/src/env.js')).toBeNull();
  });

  it('refuses a sibling directory whose name starts with the root', () => {
    // The prototype's startsWith(root) check accepted this; path.relative does not.
    expect(resolveStatic(ROOT, '/../dist-ssr/secret.js')).toBeNull();
    expect(resolveStatic('/srv/app/public', '/../public-backup/.env')).toBeNull();
  });

  it('refuses a percent-encoded climb', () => {
    expect(resolveStatic(ROOT, '/%2e%2e/%2e%2e/etc/passwd')).toBeNull();
  });

  it('refuses a path resolving to the root itself', () => {
    expect(resolveStatic(ROOT, '/..')).toBeNull();
  });
});

describe('cacheControlFor', () => {
  it('pins hashed assets, which never change under the same name', () => {
    expect(cacheControlFor(path.join(ROOT, 'assets/index-abc123.js'))).toBe(
      'public, max-age=31536000, immutable',
    );
  });

  it('never pins index.html, which is how a new build is found', () => {
    expect(cacheControlFor(path.join(ROOT, 'index.html'))).toBe('no-cache');
    expect(cacheControlFor(path.join(ROOT, 'manifest.webmanifest'))).toBe('no-cache');
  });
});

describe('TYPES', () => {
  it('covers what the built app serves', () => {
    for (const ext of ['.html', '.js', '.css', '.svg', '.webmanifest', '.png']) {
      expect(TYPES[ext]).toBeTruthy();
    }
  });
});
