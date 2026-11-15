// The log: its line format, the once-a-minute summary, and the phone reports
// that arrive at /api/telemetry.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { errText, formatLine, log, setLogWriter } from '../src/log.js';
import { summarise, type Snapshot } from '../src/metrics.js';
import { PER_ADDRESS_PER_MIN, ReportLimiter, TOTAL_PER_MIN } from '../src/http/telemetry.js';
import { createServer } from '../src/http/server.js';
import { Feed, type FeedListener } from '../src/feed/feed.js';
import { OpenF1 } from '../src/openf1/client.js';

let lines: Record<string, unknown>[] = [];
beforeEach(() => {
  lines = [];
  setLogWriter((l) => lines.push(JSON.parse(l) as Record<string, unknown>));
});
afterEach(() => setLogWriter(null));

describe('a log line', () => {
  it('is one JSON object with the level and message first', () => {
    const line = formatLine('warn', 'mqtt error', { event: 'mqtt', error: 'closed' });
    expect(line).not.toContain('\n');
    expect(JSON.parse(line)).toEqual({ level: 'warn', message: 'mqtt error', event: 'mqtt', error: 'closed' });
    expect(line.startsWith('{"level":"warn","message":"mqtt error"')).toBe(true);
  });

  it('cannot have its level or message replaced by a field', () => {
    // A phone's error text arrives as a field; it must not become the line's message.
    const parsed = JSON.parse(formatLine('info', 'client error', { message: 'spoofed', level: 'error' }));
    expect(parsed.level).toBe('info');
    expect(parsed.message).toBe('client error');
  });

  it('keeps the line when a field will not serialise', () => {
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    expect(JSON.parse(formatLine('error', 'boom', { cycle }))).toEqual({
      level: 'error',
      message: 'boom',
      unserialisable: true,
    });
  });

  it('keeps only the message of a thrown error', () => {
    const e = Object.assign(new Error('OpenF1 502 on laps'), { url: 'https://api.openf1.org/v1/laps?x=1' });
    expect(errText(e)).toBe('OpenF1 502 on laps');
    expect(errText('plain')).toBe('plain');
  });

  it('goes to the writer', () => {
    log.error('fetch failed', { event: 'fetch' });
    expect(lines).toEqual([{ level: 'error', message: 'fetch failed', event: 'fetch' }]);
  });
});

describe('the summary', () => {
  const snap = (at: number, over: Partial<Snapshot> = {}): Snapshot => ({
    at,
    requests: 0,
    errors: 0,
    rateLimited: 0,
    connects: 0,
    disconnects: 0,
    frames: {},
    ...over,
  });

  it('reports each minute by difference', () => {
    const a = snap(0, {
      requests: 100,
      errors: 2,
      rateLimited: 1,
      connects: 3,
      disconnects: 1,
      frames: { tick: { sent: 1000, bytes: 1_000_000 }, timing: { sent: 250, bytes: 800_000 } },
    });
    const b = snap(60_000, {
      requests: 146,
      errors: 3,
      rateLimited: 1,
      connects: 4,
      disconnects: 2,
      frames: {
        tick: { sent: 1240, bytes: 1_000_000 + 240 * 1090 },
        timing: { sent: 310, bytes: 800_000 + 60 * 3349 },
        hello: { sent: 1, bytes: 14_979 },
      },
    });
    expect(summarise(a, b)).toEqual({
      periodS: 60,
      openf1Requests: 46,
      openf1PerMin: 46,
      openf1Errors: 1,
      openf1RateLimited: 0,
      connects: 1,
      disconnects: 1,
      tickHz: 4,
      tickBytes: 1090,
      timingBytes: 3349,
      // (240 × 1090 + 60 × 3349 + 14,979) bytes over 60 s, the M9 measurement's shape.
      kBps: 7.96,
    });
  });

  it('says nothing about frame size when no frames went out', () => {
    const s = summarise(snap(0), snap(60_000));
    expect(s.tickHz).toBe(0);
    expect(s.tickBytes).toBeNull();
    expect(s.kBps).toBe(0);
  });

  it('scales a short period to a rate per minute', () => {
    expect(summarise(snap(0), snap(30_000, { requests: 20 })).openf1PerMin).toBe(40);
  });
});

describe('the feed counters behind the summary', () => {
  const feed = (): Feed => new Feed(new OpenF1({ baseUrl: 'http://127.0.0.1:9', minGapMs: 0 }), { liveTransport: 'rest' });
  const phone = (): FeedListener => ({ write: () => {} }) as FeedListener;

  it('counts a phone leaving once, though error and close both remove it', () => {
    const f = feed();
    const p = phone();
    f.addListener(p);
    f.removeListener(p);
    f.removeListener(p);
    expect(f.counters).toMatchObject({ connects: 1, disconnects: 1 });
  });

  it('counts frames, and their size, only when someone is listening', () => {
    const f = feed();
    f.broadcast('tick', { a: 1 });
    expect(f.counters.frames.tick).toBeUndefined();
    f.addListener(phone());
    f.addListener(phone());
    f.broadcast('tick', { a: 1 });
    const size = 'event: tick\ndata: {"a":1}\n\n'.length;
    // Once per frame, not once per phone.
    expect(f.counters.frames.tick).toEqual({ sent: 1, bytes: size });
  });
});

describe('the report limiter', () => {
  it('allows a phone its summaries and a few errors a minute, then refuses', () => {
    const l = new ReportLimiter();
    for (let i = 0; i < PER_ADDRESS_PER_MIN; i++) expect(l.allow('a', 1_000)).toBe(true);
    expect(l.allow('a', 1_000)).toBe(false);
    expect(l.allow('b', 1_000)).toBe(true);
  });

  it('caps every phone together', () => {
    const l = new ReportLimiter(1_000, TOTAL_PER_MIN);
    for (let i = 0; i < TOTAL_PER_MIN; i++) expect(l.allow(`p${i}`, 1_000)).toBe(true);
    expect(l.allow('one-more', 1_000)).toBe(false);
  });

  it('starts again each minute', () => {
    const l = new ReportLimiter(1, 10);
    expect(l.allow('a', 1_000)).toBe(true);
    expect(l.allow('a', 59_000)).toBe(false);
    expect(l.allow('a', 61_000)).toBe(true);
  });
});

describe('POST /api/telemetry', () => {
  let server: Server;
  let base = '';
  let cookie = '';

  const summary = {
    kind: 'summary',
    viewer: '0a1b2c3d',
    ua: 'Mozilla/5.0 (iPhone)',
    fps: 60,
    visibleS: 58,
    reconnects: 0,
    stalls: 0,
    contextLost: 0,
    errors: 0,
    layout: 'portrait',
  };

  const post = (body: unknown, headers: Record<string, string> = {}) =>
    fetch(`${base}/api/telemetry`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie, ...headers },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    });

  beforeEach(async () => {
    const feed = new Feed(new OpenF1({ baseUrl: 'http://127.0.0.1:9', minGapMs: 0 }), { liveTransport: 'rest' });
    server = createServer({ feed, appPassword: 'pw', sessionSecret: 'a-long-test-secret', publicDir: '/nonexistent' });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const res = await fetch(`${base}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'password=pw',
      redirect: 'manual',
    });
    cookie = res.headers.get('set-cookie')?.split(';')[0] ?? '';
  });
  afterEach(() => new Promise<void>((r) => server.close(() => r())));

  it('sits behind the password', async () => {
    cookie = '';
    expect((await post(summary)).status).toBe(401);
    expect(lines.filter((l) => l.event === 'client')).toEqual([]);
  });

  it('logs a summary as one line, without the address', async () => {
    expect((await post(summary, { 'X-Forwarded-For': '203.0.113.7' })).status).toBe(204);
    const line = lines.find((l) => l.event === 'client');
    expect(line).toMatchObject({ level: 'info', message: 'client summary', viewer: '0a1b2c3d', fps: 60 });
    expect(JSON.stringify(lines)).not.toContain('203.0.113.7');
  });

  it('warns about a phone that lost its WebGL context', async () => {
    await post({ ...summary, contextLost: 1 });
    expect(lines.find((l) => l.event === 'client')?.level).toBe('warn');
  });

  it('logs an error with its text as a field, not as the message', async () => {
    const res = await post({ kind: 'error', viewer: '0a1b2c3d', ua: 'x', message: 'boom', where: 'index.js:1:2' });
    expect(res.status).toBe(204);
    expect(lines.find((l) => l.event === 'client-error')).toMatchObject({
      level: 'warn',
      message: 'client error',
      error: 'boom',
      where: 'index.js:1:2',
    });
  });

  it('refuses what does not match the schema', async () => {
    expect((await post({ ...summary, viewer: 'not-hex!' })).status).toBe(400);
    expect((await post({ ...summary, layout: 'sideways' })).status).toBe(400);
    expect((await post({ kind: 'error', viewer: '0a1b2c3d', ua: 'x', message: 'y'.repeat(301), where: '' })).status).toBe(
      400,
    );
    expect((await post('not json')).status).toBe(400);
    expect(lines.filter((l) => String(l.event).startsWith('client'))).toEqual([]);
  });

  it('refuses a body over the limit', async () => {
    expect((await post({ ...summary, ua: 'x'.repeat(5_000) })).status).toBe(413);
  });

  it('rate limits one address', async () => {
    const codes: number[] = [];
    for (let i = 0; i <= PER_ADDRESS_PER_MIN; i++) codes.push((await post(summary)).status);
    expect(codes.slice(0, -1).every((c) => c === 204)).toBe(true);
    expect(codes.at(-1)).toBe(429);
  });
});
