// Per-car buffers, and the search and pruning that run over them.
//
// Rows are stored as compact arrays with the timestamp first, sorted by it, so a
// frame can binary-search for the samples either side of the clock. Location and
// car data arrive at about 3.7 Hz per car and are pruned to roughly 90 s behind
// the clock; everything else is small enough to keep for the session.
//
// Ported from reference/prototype/lib/feed.js.

import type { Driver, RaceControlRow } from '@lapline/shared';

/** How much location and car history to keep behind the clock. */
export const HI_KEEP_MS = 90_000;

/** Any buffered row: timestamp first, then whatever that endpoint carries. */
export type TimedRow = readonly [number, ...unknown[]];

export type LocRow = [t: number, x: number, y: number, z: number];
/** Car data keeps upstream's own order: speed, rpm, gear. Frames reorder it. */
export type CarRow = [
  t: number,
  speed: number | undefined,
  rpm: number | undefined,
  gear: number | undefined,
  throttle: number | undefined,
  brake: number | undefined,
  drs: number | undefined,
];
export type PosRow = [t: number, position: number | undefined];
export type IvlRow = [t: number, gap: number | string | null, interval: number | string | null];
export type RcBufRow = [t: number, row: RaceControlRow];
/** The pit-lane duration in seconds, so a frame can tell whether a car is still in it. */
export type PitBufRow = [t: number, durationS: number];

export interface Lap {
  n: number;
  start: number | null;
  dur: number | null;
  pitOut: boolean;
}

export interface Stint {
  compound: string | null;
  start: number;
  end: number | null;
  age0: number;
}

/** Dedupe keys per endpoint, so an overlapping refetch adds nothing twice. */
export interface SeenSets {
  location: Set<string>;
  car_data: Set<string>;
  position: Set<string>;
  intervals: Set<string>;
  race_control: Set<string>;
  pit: Set<string>;
}

export interface Buffers {
  drivers: Map<number, Driver>;
  loc: Map<number, LocRow[]>;
  car: Map<number, CarRow[]>;
  pos: Map<number, PosRow[]>;
  ivl: Map<number, IvlRow[]>;
  /** Driver number to lap number to lap, because laps are updated in place. */
  laps: Map<number, Map<number, Lap>>;
  stints: Map<number, Map<number, Stint>>;
  pits: Map<number, PitBufRow[]>;
  rc: RcBufRow[];
  seen: SeenSets;
  /** Newest upstream row timestamp seen, for the freshness signal. Null before any. */
  newest: number | null;
}

export function createBuffers(): Buffers {
  return {
    drivers: new Map(),
    loc: new Map(),
    car: new Map(),
    pos: new Map(),
    ivl: new Map(),
    laps: new Map(),
    stints: new Map(),
    pits: new Map(),
    rc: [],
    newest: null,
    seen: {
      location: new Set(),
      car_data: new Set(),
      position: new Set(),
      intervals: new Set(),
      race_control: new Set(),
      pit: new Set(),
    },
  };
}

/**
 * Index of the last row at or before `target`, or -1 if every row is later.
 *
 * Returning the *last* of several equal timestamps matters: the overlap window
 * can re-admit a duplicate row after a seen-set reset, and because this lands on
 * the later copy, a duplicate pair is never the pair a frame interpolates
 * between. Without that, `b[0] - a[0]` would be zero and positions would be NaN.
 */
export function lastAtOrBefore(arr: readonly TimedRow[], target: number): number {
  let lo = 0;
  let hi = arr.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid]![0] <= target) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
}

/**
 * Insert keeping the array sorted by timestamp. Rows usually arrive in order, so
 * this walks back from the end and almost always appends. An equal timestamp
 * lands after the row already there, which keeps the search invariant above.
 */
export function insertSorted<T extends TimedRow>(arr: T[], row: T): void {
  let i = arr.length;
  while (i > 0 && arr[i - 1]![0] > row[0]) i--;
  if (i === arr.length) arr.push(row);
  else arr.splice(i, 0, row);
}

/** The array for a driver, created on first use. */
export function bucket<T>(map: Map<number, T[]>, n: number): T[] {
  let a = map.get(n);
  if (!a) {
    a = [];
    map.set(n, a);
  }
  return a;
}

/** Numbers only; anything else becomes null, so `??` chains behave. */
export function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/**
 * Drop location and car samples that have fallen behind the clock. The seen sets
 * are cleared once they get large: the overlap window is short, so a reset only
 * risks re-admitting a few duplicates, which the search invariant tolerates.
 */
export function prune(buffers: Buffers, clockMs: number): void {
  const cutoff = clockMs - HI_KEEP_MS;
  const pairs: Array<[Map<number, TimedRow[]>, Set<string>]> = [
    [buffers.loc as unknown as Map<number, TimedRow[]>, buffers.seen.location],
    [buffers.car as unknown as Map<number, TimedRow[]>, buffers.seen.car_data],
  ];
  for (const [map, seen] of pairs) {
    for (const arr of map.values()) {
      let i = 0;
      while (i < arr.length && arr[i]![0] < cutoff) i++;
      if (i > 0) arr.splice(0, i);
    }
    if (seen.size > 200_000) seen.clear();
  }
}
