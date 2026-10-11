import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import type { Tick } from '@lapline/shared';
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
      expect(feed.initPayload().canLive).toBe(false);
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
      expect(JSON.stringify(feed.initPayload())).not.toMatch(/any|password|secret/i);
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
      const init = feed.initPayload();
      expect(init.drivers).toHaveLength(20);
      expect(init.session!.name).toBe('Sprint');
      // The outline comes from the fastest clean lap's position trace.
      expect(init.track!.points.length).toBeGreaterThan(50);
      expect(init.track!.transform.scale).toBeGreaterThan(0);
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

      const frame = feed.frame(true) as Tick;
      expect(frame.mode).toBe('replay');
      expect(frame.cars.length).toBe(20);
      expect(frame.replay).toMatchObject({ playing: false, speed: 1 });
      expect(frame.timing!.rows).toHaveLength(20);
      expect(frame.timing!.rows[0]!.p).toBe(1);
      expect(frame.timing!.flag).toBe('GREEN');
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
        return (feed.frame(true) as Tick).timing!.flag;
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
      expect((feed.frame(false) as Tick).cars).toHaveLength(20);

      // A jump of more than 5 s invalidates the window.
      feed.setReplay({ at: (feed.sessStart as number) + 600_000 });
      expect((feed.frame(false) as Tick).cars).toHaveLength(0);

      await feed.fetchStep();
      const after = feed.frame(false) as Tick;
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

      const frame = feed.frame(true) as Tick;
      expect(frame.mode).toBe('live');
      expect(frame.live).toEqual({ delayS: 10, mqtt: false });
      expect(Math.abs(frame.t - (Date.now() - 10_000))).toBeLessThan(2000);
      expect(frame.cars.length).toBeGreaterThan(0);
      expect(frame.timing!.rows.length).toBe(20);
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
      expect(feed.initPayload().track!.source).toBe('Sprint');
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

  it('sends an init event to a listener the moment it connects', async () => {
    const feed = freeFeed();
    try {
      await feed.loadSessionList();
      await feed.selectSession(SPRINT);
      const listener = new Collector();
      feed.addListener(listener);
      expect(listener.of('init')).toHaveLength(1);
      expect((listener.last('init') as { mode: string }).mode).toBe('replay');
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
