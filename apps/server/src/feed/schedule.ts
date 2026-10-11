// What to fetch next, and when.
//
// Replay: timing data loads once, then location and car data load in windows
// just ahead of the clock, the window growing with playback speed.
// Live: MQTT carries the stream, and REST polling takes over whenever MQTT has
// been quiet for 20 s, using overlapping windows.
//
// Ported from reference/prototype/lib/feed.js.

import { LIVE_PRE_MS } from './sessions.js';

/** MQTT counts as healthy while it has delivered a row this recently. */
export const MQTT_QUIET_MS = 20_000;

/**
 * The furthest back a high-rate live fetch may reach.
 *
 * Without this the window grows without bound: `fetchedUntil` only advances
 * after a success, so one failed location fetch means the next asks for
 * everything since the last good one, which fails harder, which widens it
 * again. OpenF1 answers a request that large with 422 "asking for too much
 * data at once", and the feed never recovers. Two minutes is plenty of overlap
 * to close a gap, and bounds the request whatever state the marks are in.
 */
export const MAX_HI_LOOKBACK_MS = 120_000;

/** Endpoints fetched in windows ahead of the replay clock. */
export const REPLAY_HI_ENDPOINTS = ['location', 'car_data'] as const;

/** Loaded once when a session opens, in this order. */
export const STATIC_ENDPOINTS = ['laps', 'stints', 'position', 'intervals', 'race_control', 'pit'] as const;

export type PlanKind = 'hi' | 'lo' | 'all';

/** An endpoint, how often to fetch it, and how to window it. */
export type PlanEntry = [ep: string, everyMs: number, kind: PlanKind];

/**
 * The live REST plan. When MQTT is quiet this is the whole stream; when it is
 * healthy only a slow sweep runs, to repair anything the broker missed.
 */
export function liveFetchPlan(mqttHealthy: boolean): PlanEntry[] {
  if (mqttHealthy) {
    return [
      ['laps', 120_000, 'all'],
      ['stints', 120_000, 'all'],
    ];
  }
  return [
    ['location', 4000, 'hi'],
    ['car_data', 4000, 'hi'],
    ['position', 15_000, 'lo'],
    ['intervals', 15_000, 'lo'],
    ['race_control', 15_000, 'lo'],
    ['pit', 30_000, 'lo'],
    ['laps', 30_000, 'all'],
    ['stints', 30_000, 'all'],
  ];
}

/** Requests a minute the plan asks for, if every endpoint hits its interval exactly. */
export function plannedRequestsPerMinute(plan: readonly PlanEntry[]): number {
  return plan.reduce((sum, [, every]) => sum + 60_000 / every, 0);
}

/** How far ahead of the clock to fetch. Faster playback needs a longer window. */
export function replayWindowMs(speed: number): number {
  return Math.max(30_000, 20_000 * speed);
}

/**
 * The window to fetch for a replay endpoint, or null when there is nothing to do
 * — either far enough ahead already, or past the end of the session.
 *
 * Starting no earlier than 2 s behind the clock keeps a small backward nudge
 * covered without refetching the whole buffer.
 */
export function replayWindow(
  fetchedUntil: number | undefined,
  clockMs: number,
  speed: number,
  sessEnd: number,
): { from: number; to: number } | null {
  const windowMs = replayWindowMs(speed);
  let from = fetchedUntil;
  if (from == null || from < clockMs - 2000) from = clockMs - 2000;
  if (from >= clockMs + windowMs || from >= sessEnd) return null;
  return { from, to: Math.min(from + windowMs, sessEnd + 1000) };
}

/**
 * Where a live REST window starts. `hi` endpoints overlap 10 s and reach back a
 * minute on the first call; `lo` endpoints overlap 30 s and reach back to the
 * start of the live window, so the first call picks up the session so far.
 * `all` endpoints are fetched whole and get no date filter.
 */
export function liveWindowFrom(
  kind: PlanKind,
  fetchedUntil: number | undefined,
  now: number,
  sessStart: number,
): number | null {
  if (kind === 'all') return null;
  const overlap = kind === 'hi' ? 10_000 : 30_000;
  const firstFrom = kind === 'hi' ? now - 60_000 : sessStart - LIVE_PRE_MS;
  const from = fetchedUntil != null ? fetchedUntil - overlap : firstFrom;
  // Location and car data are the big ones, so they are the ones that must not
  // run away. The low-rate endpoints are small enough to fetch whole.
  return kind === 'hi' ? Math.max(from, now - MAX_HI_LOOKBACK_MS) : from;
}

/** True when the endpoint is due again. */
export function isDue(lastFetchAt: number | undefined, everyMs: number, now: number): boolean {
  return now - (lastFetchAt || 0) >= everyMs;
}
