// What keeps an unattended run alive.
//
// M9's acceptance is "a full live session watched on a phone with no manual
// intervention", so the faults that matter are the ones nobody is there to
// work around: a lock that cannot be left, a listener that takes the stream
// down with it, and a token endpoint having a bad minute being reported as a
// lapsed sponsorship. Each test below fails without its fix.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import { OpenF1 } from '../src/openf1/client.js';
import { Feed, type FeedListener } from '../src/feed/feed.js';

const servers: Server[] = [];
const feeds: Feed[] = [];

afterEach(() => {
  for (const f of feeds.splice(0)) f.stop();
  for (const s of servers.splice(0)) s.close();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/**
 * A stand-in for OpenF1 that serves one live Race and can be told to refuse.
 *
 * The mock in `tools/mock-openf1` cannot refuse on demand, and refusing on
 * demand is the whole point: a 401 that later stops happening is exactly the
 * transient these tests are about.
 */
async function upstream(): Promise<{ base: string; refuse: (on: boolean) => void; calls: () => number }> {
  let refusing = true;
  let calls = 0;
  const now = Date.now();
  const session = {
    session_key: 9001,
    session_name: 'Race',
    session_type: 'Race',
    date_start: new Date(now - 10 * 60_000).toISOString(),
    date_end: new Date(now + 60 * 60_000).toISOString(),
    meeting_key: 7001,
    circuit_key: 61,
    circuit_short_name: 'Testville',
    country_name: 'Testland',
    year: new Date().getUTCFullYear(),
  };
  const server = createServer((req, res) => {
    const path = (req.url || '').split('?')[0] || '';
    if (path === '/token') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ access_token: 'tok', expires_in: '3600' }));
      return;
    }
    if (path === '/v1/sessions') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify([session]));
      return;
    }
    calls++;
    if (refusing) {
      res.writeHead(401, { 'content-type': 'application/json' });
      res.end('{"detail":"Not authenticated"}');
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('[]');
  });
  servers.push(server);
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  return {
    base: `http://127.0.0.1:${port}`,
    refuse: (on: boolean) => {
      refusing = on;
    },
    calls: () => calls,
  };
}

function feedFor(base: string, lockRetryMs: number): Feed {
  const feed = new Feed(new OpenF1({ baseUrl: base, minGapMs: 0, username: 'u', password: 'p' }), {
    liveTransport: 'rest',
    lockRetryMs,
  });
  feeds.push(feed);
  return feed;
}

describe('a lock is a wait, not an ending', () => {
  it('leaves locked mode once the refusal stops', async () => {
    // Before this, `mode` went to 'locked' and `fetchStep` returned early on
    // it for ever: one bad minute from the token endpoint ended the race, with
    // the screen saying locked and nothing ever asking again.
    const up = await upstream();
    const feed = feedFor(up.base, 0);

    await feed.loadSessionList();
    await feed.selectSession(9001);
    expect(feed.mode).toBe('locked');

    up.refuse(false);
    await feed.fetchStep();
    expect(feed.mode).toBe('live');
  }, 30_000);

  it('waits out the backoff rather than hammering a session that really is locked', async () => {
    const up = await upstream();
    const feed = feedFor(up.base, 60_000);

    await feed.loadSessionList();
    await feed.selectSession(9001);
    expect(feed.mode).toBe('locked');

    const after = up.calls();
    await feed.fetchStep();
    await feed.fetchStep();
    expect(feed.mode).toBe('locked');
    expect(up.calls()).toBe(after);
  }, 30_000);

  it('keeps pruning while idle, because MQTT does not stop when fetching does', async () => {
    // The idle guard stops us fetching, but it does not stop the broker
    // pushing about 160 rows a second in. Pruning lives inside `fetchStep`
    // below that guard, so an unattended phone that went to sleep used to
    // leave the buffers growing with nothing trimming them.
    const up = await upstream();
    const feed = feedFor(up.base, 0);
    up.refuse(false);
    await feed.loadSessionList();
    await feed.selectSession(9001);

    // Nobody has connected, but `lastClients` starts at construction time, so
    // reach past the one-minute threshold rather than waiting out a minute.
    (feed as unknown as { lastClients: number }).lastClients = Date.now() - 2 * 60_000;

    const t = feed.clock();
    const old = t - 10 * 60_000;
    const loc = (feed as unknown as { buffers: { loc: Map<number, number[][]> } }).buffers.loc;
    loc.set(1, [
      [old, 1, 1, 1],
      [t, 2, 2, 2],
    ]);

    expect(feed.idle()).toBe(true);
    await feed.fetchStep();
    expect(loc.get(1)!.some((r) => r[0] === old)).toBe(false);
  }, 30_000);
});

describe('one bad listener costs the others nothing', () => {
  it('still writes to every other listener, and drops the one that threw', async () => {
    const up = await upstream();
    const feed = feedFor(up.base, 0);
    const good: string[] = [];
    const bad: FeedListener = {
      write() {
        throw new Error('socket is gone');
      },
    };
    const after: FeedListener = { write: (c) => void good.push(c) };
    feed.listeners.add(bad);
    feed.listeners.add(after);

    feed.broadcast('ping', { t: 1 });
    expect(good).toHaveLength(1);
    expect(feed.listeners.has(bad)).toBe(false);

    // And the next frame is not spent on it again.
    feed.broadcast('ping', { t: 2 });
    expect(good).toHaveLength(2);
  });
});

describe('the token endpoint having a bad minute is not a lapsed sponsorship', () => {
  const stubToken = (status: number): void => {
    vi.stubGlobal('fetch', async (url: string) =>
      String(url).endsWith('/token')
        ? new Response(status === 200 ? '{"access_token":"t","expires_in":"3600"}' : '{"detail":"oops"}', { status })
        : new Response('[]', { status: 200 }),
    );
  };

  it('does not report rejected for a 503', async () => {
    stubToken(503);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const api = new OpenF1({ baseUrl: 'http://openf1.test', minGapMs: 0, username: 'u', password: 'p' });
    await api.get('drivers');
    expect(api.authState).not.toBe('rejected');
  });

  it('still reports rejected for a 401, which does say something about the credential', async () => {
    stubToken(401);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const api = new OpenF1({ baseUrl: 'http://openf1.test', minGapMs: 0, username: 'u', password: 'p' });
    await api.get('drivers');
    expect(api.authState).toBe('rejected');
  });
});
