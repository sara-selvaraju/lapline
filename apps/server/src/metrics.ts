// The once-a-minute summary line in the log.
//
// It answers what `npm run soak` was written to measure, at every race and
// without anyone remembering to run it: how hard the server is leaning on
// OpenF1's rate limit, how big the frames are, how many phones are watching
// and reconnecting, and whether memory is flat. Railway's log search finds
// them with `@event:summary`.
//
// The counters it reads only count up. Each line is the difference between
// two snapshots a minute apart, worked out by a pure function so the
// arithmetic is tested without a clock.

import type { Feed, FeedCounters } from './feed/feed.js';
import type { OpenF1 } from './openf1/client.js';
import type { Fields } from './log.js';

export const SUMMARY_EVERY_MS = 60_000;

export interface Snapshot {
  at: number;
  requests: number;
  errors: number;
  rateLimited: number;
  connects: number;
  disconnects: number;
  frames: FeedCounters['frames'];
}

/** A copy of the running totals, so later counting cannot change it. */
export function takeSnapshot(feed: Feed, api: OpenF1, at: number = Date.now()): Snapshot {
  const frames: FeedCounters['frames'] = {};
  for (const [event, c] of Object.entries(feed.counters.frames)) frames[event] = { ...c };
  return {
    at,
    requests: api.stats.requests,
    errors: api.stats.errors,
    rateLimited: api.stats.rateLimited,
    connects: feed.counters.connects,
    disconnects: feed.counters.disconnects,
    frames,
  };
}

/** What happened to the frames of one event between two snapshots. */
function frameRate(prev: Snapshot, cur: Snapshot, event: string, seconds: number) {
  const a = prev.frames[event] ?? { sent: 0, bytes: 0 };
  const b = cur.frames[event] ?? { sent: 0, bytes: 0 };
  const sent = b.sent - a.sent;
  const bytes = b.bytes - a.bytes;
  return {
    perS: round(sent / seconds, 2),
    avgBytes: sent ? Math.round(bytes / sent) : null,
    bytes,
  };
}

const round = (n: number, places: number): number => {
  const f = 10 ** places;
  return Math.round(n * f) / f;
};

/** The counted part of the summary: everything that is a difference over the period. */
export function summarise(prev: Snapshot, cur: Snapshot): Fields {
  const seconds = Math.max((cur.at - prev.at) / 1000, 1);
  const tick = frameRate(prev, cur, 'tick', seconds);
  const timing = frameRate(prev, cur, 'timing', seconds);
  let allBytes = 0;
  for (const event of new Set([...Object.keys(prev.frames), ...Object.keys(cur.frames)])) {
    allBytes += frameRate(prev, cur, event, seconds).bytes;
  }
  const requests = cur.requests - prev.requests;
  return {
    periodS: Math.round(seconds),
    openf1Requests: requests,
    openf1PerMin: round((requests * 60) / seconds, 1),
    openf1Errors: cur.errors - prev.errors,
    openf1RateLimited: cur.rateLimited - prev.rateLimited,
    connects: cur.connects - prev.connects,
    disconnects: cur.disconnects - prev.disconnects,
    tickHz: tick.perS,
    tickBytes: tick.avgBytes,
    timingBytes: timing.avgBytes,
    // What one phone received, all events included.
    kBps: round(allBytes / seconds / 1000, 2),
  };
}

const mb = (bytes: number): number => round(bytes / 1_048_576, 1);

/** The whole line: the differences, plus what is true right now. */
export function summaryFields(prev: Snapshot, cur: Snapshot, feed: Feed, api: OpenF1): Fields {
  const mem = process.memoryUsage();
  const mqttAge = feed.mqttAgeMs(cur.at);
  return {
    event: 'summary',
    mode: feed.mode,
    session: feed.session?.session_key ?? null,
    viewers: feed.listeners.size,
    ...summarise(prev, cur),
    openf1Auth: api.authState,
    ...(mqttAge === null ? {} : { mqttAgeS: round(mqttAge / 1000, 1) }),
    ...(feed.mode === 'live' ? { delayS: feed.liveDelayMs / 1000 } : {}),
    rssMB: mb(mem.rss),
    heapMB: mb(mem.heapUsed),
  };
}
