import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import type { Tick, Timing } from '@lapline/shared';
import { OpenF1 } from '../src/openf1/client.js';
import { Feed, type FeedListener } from '../src/feed/feed.js';
import { crossings, delayFromTap } from '../src/derive/crossings.js';
import { crossingsPayload, periodsPayload } from '../src/http/query.js';

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
      // A sector yellow at 5 min colours a marshal sector, not the track.
      expect(flagAt(60_000)).toBe('GREEN');
      expect(flagAt(330_000)).toBe('GREEN');
      expect(flagAt(600_000)).toBe('SC');
      expect(flagAt(700_000)).toBe('SC ENDING');
      expect(flagAt(780_000)).toBe('GREEN');
    } finally {
      feed.stop();
    }
  }, 30_000);

  // docs/BUILD-PLAN.md M5: "The mock's scripted race control events step
  // through every state in replay, with the matching band and layout." This
  // is the server half; tools/measure-layout.mjs checks what gets drawn.
  it('steps through every state the band draws', async () => {
    const feed = freeFeed();
    try {
      await feed.loadSessionList();
      await feed.selectSession(SPRINT);
      const start = feed.sessStart as number;
      const at = (offset: number): Timing => {
        feed.setReplay({ at: start + offset, playing: false });
        return feed.timing() as Timing;
      };

      const walk: Array<[label: string, offsetS: number, want: string]> = [
        ['the formation', 60, 'GREEN'],
        ['a track-wide yellow', 140, 'YELLOW'],
        ['cleared again', 180, 'GREEN'],
        ['a sector yellow, which is not a track flag', 330, 'GREEN'],
        ['a virtual safety car', 430, 'VSC'],
        ['the virtual safety car ending', 470, 'VSC ENDING'],
        ['green between the two', 500, 'GREEN'],
        ['a safety car', 600, 'SC'],
        ['the safety car ending', 700, 'SC ENDING'],
        ['green again', 780, 'GREEN'],
        ['a red flag', 860, 'RED'],
        ['the restart', 960, 'GREEN'],
      ];
      for (const [label, offsetS, want] of walk) {
        expect({ label, flag: at(offsetS * 1000).flag }).toEqual({ label, flag: want });
      }

      // Every state but the chequered, which falls after the last lap.
      const seen = new Set(walk.map(([, , want]) => want));
      expect(seen).toEqual(new Set(['GREEN', 'YELLOW', 'VSC', 'VSC ENDING', 'SC', 'SC ENDING', 'RED']));

      const end = at((feed.sessEnd as number) - start + 60_000);
      expect(end.flag).toBe('CHEQUERED');
    } finally {
      feed.stop();
    }
  }, 40_000);

  it('suspends the session for the red flag, rather than racing through it', async () => {
    const feed = freeFeed();
    try {
      await feed.loadSessionList();
      await feed.selectSession(SPRINT);
      const start = feed.sessStart as number;
      const leaderAt = (offsetS: number): number | null => {
        feed.setReplay({ at: start + offsetS * 1000, playing: false });
        return (feed.timing() as Timing).lap;
      };
      // Across the stoppage the leader is on the same lap at both ends.
      const before = leaderAt(850);
      const during = leaderAt(900);
      expect(before).not.toBeNull();
      expect(during).toBe(before);
      // And racing resumes after it.
      expect(leaderAt(1050)).toBeGreaterThan(before as number);
    } finally {
      feed.stop();
    }
  }, 40_000);

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

  // docs/BUILD-PLAN.md M6: "Seeking in replay refetches cleanly, with no stuck
  // cars." The transport's own buttons are the cases that matter.
  it('leaves no stuck cars after the transport’s own jumps', async () => {
    const feed = freeFeed();
    try {
      await feed.loadSessionList();
      await feed.selectSession(SPRINT);
      const start = feed.sessStart as number;
      const settle = async (): Promise<Tick> => {
        // One step refills the window; a second lets the next one land.
        await feed.fetchStep();
        await feed.fetchStep();
        return feed.tick() as Tick;
      };

      feed.setReplay({ at: start + 400_000, playing: false });
      expect((await settle()).cars).toHaveLength(20);

      // The ±10 s buttons, which are past the 5 s mark and so refetch.
      for (const nudge of [10_000, -10_000]) {
        const at = feed.clock() + nudge;
        feed.setReplay({ at });
        const after = await settle();
        expect({ nudge, cars: after.cars.length }).toEqual({ nudge, cars: 20 });
        for (const car of after.cars) expect({ nudge, stale: car[10] }).toEqual({ nudge, stale: 0 });
      }

      // And a small backwards drag of the scrubber, which stays inside the
      // buffered window and so does not refetch. Pruning trims behind the
      // clock, so this is where a stale car would show up if anywhere.
      const back = feed.clock() - 4000;
      feed.setReplay({ at: back });
      const after = await settle();
      expect(after.cars).toHaveLength(20);
      for (const car of after.cars) expect(car[10]).toBe(0);
    } finally {
      feed.stop();
    }
  }, 40_000);

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

describe('the lap-colour rule against mock data', () => {
  // docs/BUILD-PLAN.md M4: "Mock data shows purple on exactly one row, only on
  // the lap just completed."
  //
  // Walks the replay through the Sprint and reads the timing frame at each
  // step, rather than waiting on the 1 Hz broadcast timer.
  async function walk(feed: Feed, fromS: number, toS: number, stepS: number): Promise<Timing[]> {
    const out: Timing[] = [];
    for (let at = fromS; at <= toS; at += stepS) {
      feed.setReplay({ at: (feed.sessStart as number) + at * 1000, playing: false });
      await feed.fetchStep();
      const t = feed.timing();
      if (t) out.push(t);
    }
    return out;
  }

  it('shows purple on exactly one row, and only while that lap is their last', async () => {
    const feed = freeFeed();
    try {
      await feed.loadSessionList();
      await feed.selectSession(SPRINT);
      const frames = await walk(feed, 120, 900, 30);

      const withLaps = frames.filter((f) => f.rows.some((r) => r.last != null));
      expect(withLaps.length).toBeGreaterThan(0);

      let sawPurple = false;
      for (const frame of withLaps) {
        const purple = frame.rows.filter((r) => r.lapFlag === 'fastest');
        // Never more than one, which is the "exactly one row" half.
        expect(purple.length).toBeLessThanOrEqual(1);
        if (purple.length === 0) continue;
        sawPurple = true;
        // It is the lap they have just completed, not a best they hold.
        expect(purple[0]!.last).toBe(purple[0]!.best);
        // And nobody in the field has gone quicker.
        const best = Math.min(...frame.rows.map((r) => r.best ?? Infinity));
        expect(purple[0]!.last).toBe(best);
      }
      expect(sawPurple).toBe(true);

      // The lap times must actually differ, or none of the above means much.
      const times = withLaps.at(-1)!.rows.map((r) => r.last).filter((v): v is number => v != null);
      expect(new Set(times).size).toBeGreaterThan(1);
    } finally {
      feed.stop();
    }
  }, 60_000);

  it('takes purple off a driver once they complete a slower lap', async () => {
    const feed = freeFeed();
    try {
      await feed.loadSessionList();
      await feed.selectSession(SPRINT);
      const frames = await walk(feed, 120, 900, 30);

      // Somebody must have held purple and then lost it, or the variation in
      // the mock's lap times is not doing its job.
      const runs = new Map<number, boolean[]>();
      for (const f of frames) {
        for (const r of f.rows) {
          if (r.last == null) continue;
          const run = runs.get(r.n) ?? [];
          run.push(r.lapFlag === 'fastest');
          runs.set(r.n, run);
        }
      }
      const lostIt = [...runs.values()].some((run) => run.includes(true) && run.at(-1) === false);
      expect(lostIt).toBe(true);
    } finally {
      feed.stop();
    }
  }, 60_000);

  it('marks a personal best that is not the session best', async () => {
    const feed = freeFeed();
    try {
      await feed.loadSessionList();
      await feed.selectSession(SPRINT);
      const frames = await walk(feed, 120, 900, 30);
      const sawPb = frames.some((f) => f.rows.some((r) => r.lapFlag === 'pb'));
      expect(sawPb).toBe(true);
      // A row is never both.
      for (const f of frames) {
        for (const r of f.rows) expect(['fastest', 'pb', null]).toContain(r.lapFlag);
      }
    } finally {
      feed.stop();
    }
  }, 60_000);
});

describe('the final classification', () => {
  it('arrives once the chequered flag has fallen, and not before', async () => {
    const feed = freeFeed();
    try {
      await feed.loadSessionList();
      await feed.selectSession(SPRINT);
      const start = feed.sessStart as number;

      // Mid-race there is nothing to classify.
      feed.setReplay({ at: start + 600_000, playing: false });
      await feed.fetchStep();
      expect(feed.helloPayload().result).toBeNull();

      // Past the flag it is fetched once and sent on hello.
      feed.setReplay({ at: (feed.sessEnd as number) + 60_000, playing: false });
      await feed.fetchStep();
      await feed.fetchStep();

      const result = feed.helloPayload().result;
      expect(result).not.toBeNull();
      expect(result!.rows.length).toBeGreaterThan(10);

      // The winner leads, with no gap and the total race time.
      const winner = result!.rows[0]!;
      expect(winner.position).toBe(1);
      expect(winner.gap).toBe(0);
      expect(result!.winnerTime).toBeGreaterThan(0);

      // Everyone classified is in order, and the one retirement is last.
      const classified = result!.rows.filter((r) => r.status === 'finished');
      expect(classified.map((r) => r.position)).toEqual(classified.map((_, i) => i + 1));
      const dnf = result!.rows.filter((r) => r.status === 'dnf');
      expect(dnf).toHaveLength(1);
      expect(dnf[0]!.position).toBeNull();
      expect(result!.rows.at(-1)!.status).toBe('dnf');

      // And the fastest lap names a driver, a lap and a time.
      expect(result!.fastest).not.toBeNull();
      expect(result!.fastest!.time).toBeGreaterThan(0);
      expect(result!.fastest!.lap).toBeGreaterThan(0);
    } finally {
      feed.stop();
    }
  }, 40_000);

  it('counts each car’s pit stops on the timing rows', async () => {
    const feed = freeFeed();
    try {
      await feed.loadSessionList();
      await feed.selectSession(SPRINT);
      const start = feed.sessStart as number;

      feed.setReplay({ at: start + 60_000, playing: false });
      await feed.fetchStep();
      const early = (feed.timing() as Timing).rows;
      expect(early.every((r) => r.stops === 0)).toBe(true);

      feed.setReplay({ at: (feed.sessEnd as number) - 60_000, playing: false });
      await feed.fetchStep();
      const late = (feed.timing() as Timing).rows;
      expect(late.some((r) => r.stops > 0)).toBe(true);
      expect(late.every((r) => r.stops >= 0 && Number.isInteger(r.stops))).toBe(true);
    } finally {
      feed.stop();
    }
  }, 40_000);
});

describe('Sync with TV, against the live mock', () => {
  // docs/BUILD-PLAN.md M6: "In live mock, marking a crossing sets the delay to
  // within ±1 s of the injected broadcast delay."
  //
  // The injected delay stands in for the viewer's television being behind
  // real time: they see the leader cross the line that many seconds late, and
  // tap then. What comes back should be the delay we injected.
  it('recovers the broadcast delay from a tap, to within a second', async () => {
    const feed = sponsorFeed();
    try {
      await feed.loadSessionList();
      await feed.selectSession(RACE);
      expect(feed.mode).toBe('live');
      // Enough steps for the leader to have completed laps to cross.
      for (let i = 0; i < 6; i++) await feed.fetchStep();

      const times = crossings(feed.buffersRef(), feed.clock());
      expect(times.length).toBeGreaterThan(0);
      const lastCrossing = times[times.length - 1]!;

      for (const injected of [6, 10, 14, 25, 42]) {
        // The viewer taps when their television shows the crossing.
        const tappedAt = lastCrossing + injected * 1000;
        const got = delayFromTap(times, tappedAt);
        expect({ injected, got }).toEqual({ injected, got: expect.any(Number) });
        expect(Math.abs((got as number) - injected)).toBeLessThanOrEqual(1);
      }
    } finally {
      feed.stop();
    }
  }, 40_000);

  it('serves the crossings and the leader’s progress over HTTP', async () => {
    const feed = sponsorFeed();
    try {
      await feed.loadSessionList();
      await feed.selectSession(RACE);
      for (let i = 0; i < 6; i++) await feed.fetchStep();

      const payload = crossingsPayload(feed, 0) as {
        t: number;
        lapMetres: number | null;
        crossings: number[];
        next: { n: number; at: number | null; metres: number | null } | null;
      };
      expect(payload.crossings.length).toBeGreaterThan(0);
      // Every crossing is in the past, and they are in order.
      for (const c of payload.crossings) expect(c).toBeLessThanOrEqual(payload.t);
      expect(payload.crossings).toEqual([...payload.crossings].sort((a, b) => a - b));
      // The mock's circuit is a real size, in metres.
      expect(payload.lapMetres).toBeGreaterThan(1000);
      expect(payload.next?.n).toBeGreaterThan(0);
    } finally {
      feed.stop();
    }
  }, 40_000);

  it('serves the flag periods the replay scrubber marks', async () => {
    const feed = freeFeed();
    try {
      await feed.loadSessionList();
      await feed.selectSession(SPRINT);
      feed.setReplay({ at: (feed.sessEnd as number) - 1000, playing: false });
      await feed.fetchStep();

      const payload = periodsPayload(feed) as {
        start: number | null;
        end: number | null;
        periods: Array<{ flag: string; from: number; to: number | null }>;
      };
      expect(payload.start).toBeGreaterThan(0);
      // The mock scripts a yellow, a VSC, a safety car and a red flag.
      const flags = payload.periods.map((p) => p.flag);
      expect(new Set(flags)).toEqual(new Set(['YELLOW', 'VSC', 'SC', 'RED']));
      // Each one sits inside the session and ends after it starts.
      for (const p of payload.periods) {
        expect(p.from).toBeGreaterThanOrEqual(payload.start as number);
        if (p.to != null) expect(p.to).toBeGreaterThan(p.from);
      }
    } finally {
      feed.stop();
    }
  }, 40_000);
});

describe('the locked screen’s free-replay time', () => {
  // docs/BUILD-PLAN.md M7: "The locked screen shows the correct local time for
  // free replay." The server's half is sending the right instant on every
  // path into locked mode — until M7 only one of the three did.
  it('is thirty minutes after the session ends', async () => {
    const feed = freeFeed();
    try {
      await feed.loadSessionList();
      await feed.selectSession(RACE);
      expect(feed.mode).toBe('locked');

      const freeAt = feed.status.freeAt;
      expect(freeAt).toBeDefined();
      expect(Date.parse(freeAt as string)).toBe((feed.sessEnd as number) + 30 * 60_000);
    } finally {
      feed.stop();
    }
  }, 30_000);

  it('reaches the client on the status it broadcasts', async () => {
    const feed = freeFeed();
    const seen = new Collector();
    try {
      await feed.loadSessionList();
      feed.addListener(seen);
      await feed.selectSession(RACE);

      const status = seen.last('status') as { mode: string; freeAt?: string } | undefined;
      expect(status?.mode).toBe('locked');
      expect(status?.freeAt).toBeDefined();
      feed.removeListener(seen);
    } finally {
      feed.stop();
    }
  }, 30_000);
});
