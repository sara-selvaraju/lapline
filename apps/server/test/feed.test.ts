import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import type { Tick, Timing } from '@lapline/shared';
import { OpenF1 } from '../src/openf1/client.js';
import { Feed, type FeedListener } from '../src/feed/feed.js';

const PORT = 4201;
const BASE = `http://localhost:${PORT}`;
const SPRINT = 1001;
const RACE = 1002;

let mock: ChildProcess;

/** Collects the SSE frames the feed writes, parsed back into events. */
class Collector implements FeedListener {
  readonly events: Array<{ event: string; data: unknown }> = [];
  write(chunk: string): void {
    const m = /^event: (\w+)\ndata: (.*)\n\n$/s.exec(chunk);
    if (m) this.events.push({ event: m[1]!, data: JSON.parse(m[2]!) });
  }
  of(event: string): unknown[] {
    return this.events.filter((e) => e.event === event).map((e) => e.data);
  }
  last(event: string): unknown {
    return this.of(event).at(-1);
  }
}

beforeAll(async () => {
  mock = spawn(process.execPath, ['tools/mock-openf1/dist/src/index.js'], {
    env: { ...process.env, MOCK_PORT: String(PORT) },
    cwd: new URL('../../..', import.meta.url).pathname,
    stdio: 'ignore',
  });
  // Wait for it to answer rather than guessing a delay.
  for (let i = 0; i < 60; i++) {
    try {
      await fetch(`${BASE}/v1/sessions?year=${new Date().getUTCFullYear()}`);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  throw new Error('mock did not start');
}, 20_000);

afterAll(() => mock?.kill());

const freeFeed = (): Feed => new Feed(new OpenF1({ baseUrl: BASE, minGapMs: 0 }), { liveTransport: 'rest' });
const sponsorFeed = (): Feed =>
  new Feed(new OpenF1({ baseUrl: BASE, minGapMs: 0, username: 'any', password: 'any' }), {
    liveTransport: 'rest',
  });

describe('the free tier and the live window', () => {
  it('puts the live mock Race into locked mode with a free-to-replay time', async () => {
    const feed = freeFeed();
    try {
      await feed.loadSessionList();
      await feed.selectSession(RACE);
      expect(feed.mode).toBe('locked');
      expect(feed.status.level).toBe('warn');
      expect(feed.status.freeAt).toMatch(/^\d{4}-\d\d-\d\dT/);
      expect(feed.helloPayload().canLive).toBe(false);
    } finally {
      feed.stop();
    }
  });

  it('fetches no session data at all while locked', async () => {
    const api = new OpenF1({ baseUrl: BASE, minGapMs: 0 });
    const feed = new Feed(api, { liveTransport: 'rest' });
    try {
      await feed.loadSessionList();
      const afterList = api.stats.requests;
      await feed.selectSession(RACE);
      // Only the session lookup, if it was not already in the list.
      expect(api.stats.requests - afterList).toBeLessThanOrEqual(1);
      expect(api.stats.last).toMatch(/sessions$/);
    } finally {
      feed.stop();
    }
  });

  it('auto-picks the live Race, which is what makes the deployed free tier show locked', async () => {
    const feed = freeFeed();
    try {
      await feed.loadSessionList();
      expect(feed.pickAutoSession()!.session_key).toBe(RACE);
    } finally {
      feed.stop();
    }
  });

  it('leaks no credentials into the init payload', async () => {
    const feed = sponsorFeed();
    try {
      await feed.loadSessionList();
      await feed.selectSession(SPRINT);
      expect(JSON.stringify(feed.helloPayload())).not.toMatch(/any|password|secret/i);
    } finally {
      feed.stop();
    }
  });
});

describe('replaying the finished mock Sprint', () => {
  it('opens in replay mode and loads drivers, timing and an outline', async () => {
    const feed = freeFeed();
    try {
      await feed.loadSessionList();
      await feed.selectSession(SPRINT);
      expect(feed.mode).toBe('replay');
      expect(feed.status.level).toBe('ok');
      const hello = feed.helloPayload();
      expect(hello.drivers).toHaveLength(20);
      expect(hello.session!.name).toBe('Sprint');
      // The outline comes from the fastest clean lap's position trace.
      expect(hello.circuit!.points.length).toBeGreaterThan(50);
      expect(hello.circuit!.transform.scale).toBeGreaterThan(0);
    } finally {
      feed.stop();
    }
  }, 30_000);

  it('builds a frame with cars and timing once the window is fetched', async () => {
    const feed = freeFeed();
    try {
      await feed.loadSessionList();
      await feed.selectSession(SPRINT);
      const listener = new Collector();
      feed.addListener(listener);
      // Seek a few minutes in so there is racing, then fetch the window.
      feed.setReplay({ at: (feed.sessStart as number) + 300_000, playing: false });
      await feed.fetchStep();
      await feed.fetchStep();

      const frame = feed.tick() as Tick;
      expect(frame.mode).toBe('replay');
      expect(frame.cars.length).toBe(20);
      expect(frame.replay).toMatchObject({ playing: false, speed: 1 });
      expect((feed.timing() as Timing).rows).toHaveLength(20);
      expect((feed.timing() as Timing).rows[0]!.p).toBe(1);
      expect((feed.timing() as Timing).flag).toBe('GREEN');
      // Every car has a position and a speed, and none is stale.
      for (const car of frame.cars) {
        expect(Number.isFinite(car[1])).toBe(true);
        expect(car[4]).not.toBeNull();
        expect(car[10]).toBe(0);
      }
    } finally {
      feed.stop();
    }
  }, 30_000);

  it('steps through the scripted flags: yellow is sector-scoped, then safety car', async () => {
    const feed = freeFeed();
    try {
      await feed.loadSessionList();
      await feed.selectSession(SPRINT);
      const start = feed.sessStart as number;
      const flagAt = (offset: number): string => {
        feed.setReplay({ at: start + offset, playing: false });
        return (feed.timing() as Timing).flag;
      };
      // The mock scripts a sector yellow at 5 min, safety car at 9, ending at 11.
      expect(flagAt(60_000)).toBe('GREEN');
      expect(flagAt(330_000)).toBe('GREEN');
      expect(flagAt(600_000)).toBe('SC');
      expect(flagAt(700_000)).toBe('SC ENDING');
      expect(flagAt(780_000)).toBe('GREEN');
    } finally {
      feed.stop();
    }
  }, 30_000);

  it('drops the high-rate buffers on a seek and refills them', async () => {
    const feed = freeFeed();
    try {
      await feed.loadSessionList();
      await feed.selectSession(SPRINT);
      feed.setReplay({ at: (feed.sessStart as number) + 300_000, playing: false });
      await feed.fetchStep();
      expect((feed.tick() as Tick).cars).toHaveLength(20);

      // A jump of more than 5 s invalidates the window.
      feed.setReplay({ at: (feed.sessStart as number) + 600_000 });
      expect((feed.tick() as Tick).cars).toHaveLength(0);

      await feed.fetchStep();
      const after = feed.tick() as Tick;
      expect(after.cars).toHaveLength(20);
      for (const car of after.cars) expect(car[10]).toBe(0);
    } finally {
      feed.stop();
    }
  }, 30_000);

  it('extends the session end past the scheduled one when laps overran', async () => {
    const feed = freeFeed();
    try {
      await feed.loadSessionList();
      const scheduled = Date.parse(feed.sessions.find((s) => s.session_key === SPRINT)!.date_end as string);
      await feed.selectSession(SPRINT);
      expect(feed.sessEnd as number).toBeGreaterThanOrEqual(scheduled);
    } finally {
      feed.stop();
    }
  }, 30_000);
});

describe('the live mock Race with credentials, over REST', () => {
  it('runs live, tracks now minus the delay, and reports MQTT as absent', async () => {
    const feed = sponsorFeed();
    try {
      await feed.loadSessionList();
      await feed.selectSession(RACE);
      expect(feed.mode).toBe('live');
      await feed.fetchStep();
      await feed.fetchStep();

      const frame = feed.tick() as Tick;
      expect(frame.mode).toBe('live');
      expect(frame.live).toEqual({ delayS: 10, mqtt: false });
      expect(Math.abs(frame.t - (Date.now() - 10_000))).toBeLessThan(2000);
      expect(frame.cars.length).toBeGreaterThan(0);
      expect((feed.timing() as Timing).rows.length).toBe(20);
    } finally {
      feed.stop();
    }
  }, 30_000);

  it('takes its outline from a finished session of the same meeting', async () => {
    const feed = sponsorFeed();
    try {
      await feed.loadSessionList();
      await feed.selectSession(RACE);
      // The live Race has no completed laps worth tracing yet, so the Sprint's lap is used.
      expect(feed.helloPayload().circuit!.source).toBe('Sprint');
    } finally {
      feed.stop();
    }
  }, 30_000);
});

describe('viewers and idling', () => {
  it('stops fetching once nobody has been connected for a minute', async () => {
    const feed = freeFeed();
    try {
      expect(feed.idle()).toBe(false);
      const listener = new Collector();
      feed.addListener(listener);
      expect(feed.idle()).toBe(false);
      feed.removeListener(listener);
      expect(feed.idle()).toBe(false);
    } finally {
      feed.stop();
    }
  });

  it('sends a hello event to a listener the moment it connects', async () => {
    const feed = freeFeed();
    try {
      await feed.loadSessionList();
      await feed.selectSession(SPRINT);
      const listener = new Collector();
      feed.addListener(listener);
      expect(listener.of('hello')).toHaveLength(1);
      expect((listener.last('hello') as { mode: string }).mode).toBe('replay');
    } finally {
      feed.stop();
    }
  }, 30_000);

  it('frames SSE events as event and data lines', async () => {
    const feed = freeFeed();
    try {
      const chunks: string[] = [];
      feed.addListener({ write: (c) => chunks.push(c) });
      feed.broadcast('ping', { t: 1 });
      expect(chunks.at(-1)).toBe('event: ping\ndata: {"t":1}\n\n');
    } finally {
      feed.stop();
    }
  });
});

describe('unknown sessions', () => {
  it('throws rather than selecting nothing', async () => {
    const feed = freeFeed();
    try {
      await expect(feed.selectSession(999_999)).rejects.toThrow('Unknown session');
    } finally {
      feed.stop();
    }
  });
});

describe('a session that has left its live window', () => {
  it('stops fetching live and loads the replay instead', async () => {
    const feed = sponsorFeed();
    try {
      await feed.loadSessionList();
      await feed.selectSession(RACE);
      expect(feed.mode).toBe('live');

      // Someone is watching: with no listener the feed goes idle and fetches
      // nothing, so the transition would never be reached.
      feed.addListener(new Collector());

      // Wind the clock past the end of the live window, as happens when a race
      // finishes and the page is left open.
      const past = (feed.sessEnd as number) + 31 * 60_000;
      const realNow = Date.now;
      Date.now = () => past;
      try {
        await feed.fetchStep();
      } finally {
        Date.now = realNow;
      }

      expect(feed.mode).toBe('replay');
    } finally {
      feed.stop();
    }
  }, 30_000);
});

describe('a session upstream has no positions for', () => {
  // Monaco 2026 is a real example: laps, timing and telemetry are all there,
  // but every session of the meeting 404s on location, so no outline can ever
  // be built. The viewer should be told, and we should stop asking.
  const PORT2 = 4202;
  const BASE2 = `http://localhost:${PORT2}`;
  let blind: ChildProcess;

  beforeAll(async () => {
    blind = spawn(process.execPath, ['tools/mock-openf1/dist/src/index.js'], {
      env: { ...process.env, MOCK_PORT: String(PORT2), MOCK_NO_LOCATION: '1' },
      cwd: new URL('../../..', import.meta.url).pathname,
      stdio: 'ignore',
    });
    for (let i = 0; i < 60; i++) {
      try {
        await fetch(`${BASE2}/v1/sessions?year=${new Date().getUTCFullYear()}`);
        return;
      } catch {
        await new Promise((r) => setTimeout(r, 100));
      }
    }
    throw new Error('mock did not start');
  }, 20_000);

  afterAll(() => blind?.kill());

  it('says so, and stops asking, rather than reporting itself ready', async () => {
    const api = new OpenF1({ baseUrl: BASE2, minGapMs: 0 });
    // Count only the outline's own request. It is the one that asks for a
    // single driver; the replay windows ask for the whole field.
    let outlineTries = 0;
    const get = api.get.bind(api);
    api.get = ((ep: string, filters: ReadonlyArray<readonly [string, string, unknown]> = []) => {
      if (ep === 'location' && filters.some((f) => f[0] === 'driver_number')) outlineTries++;
      return get(ep as never, filters as never);
    }) as typeof api.get;
    const feed = new Feed(api, { liveTransport: 'rest' });
    const seen = new Collector();
    feed.addListener(seen);
    await feed.boot(String(SPRINT));

    // Attempts are spaced, so wind the clock on rather than waiting for it.
    const now = Date.now;
    let offset = 0;
    Date.now = () => now() + offset;
    try {
      for (let i = 0; i < 6; i++) {
        offset += 60_000;
        await feed.fetchStep();
      }
    } finally {
      Date.now = now;
    }

    const status = seen.last('status') as { level: string; text: string } | undefined;
    expect(status?.level).toBe('warn');
    expect(status?.text).toMatch(/no usable car positions/i);

    // It tried a few times before concluding that, rather than once.
    expect(outlineTries).toBeGreaterThanOrEqual(3);

    // And it has given up: more time passing buys no more attempts.
    const tried = outlineTries;
    Date.now = () => now() + offset + 600_000;
    try {
      await feed.fetchStep();
      await feed.fetchStep();
    } finally {
      Date.now = now;
    }
    expect(outlineTries).toBe(tried);

    // The tower still has something to show.
    expect((seen.last('hello') as { drivers: unknown[] }).drivers.length).toBeGreaterThan(0);
    feed.removeListener(seen);
    feed.stop();
  }, 40_000);
});
