// When the leader crosses the start/finish line, and what that is worth.
//
// This is the whole basis of "Sync with TV": the viewer taps as the leader
// crosses the line on their television, and the difference between that tap
// and the moment it really happened is how far behind real time their
// broadcast is.
//
// Lap start times carry the accuracy. Across Singapore 2026's 62 laps, each
// start matches the previous start plus its duration to within 350 ms, mean
// 72 ms, so a crossing is good to a few tenths — comfortably inside the one
// second the milestone asks for.

import { lastAtOrBefore, type Buffers } from '../feed/buffers.js';

/** docs/DESIGN.md and SyncSheet.dc.html: under this is not a real broadcast delay. */
export const MIN_DELAY_S = 4;
export const MAX_DELAY_S = 180;

/**
 * OpenF1's coordinates in metres.
 *
 * Measured rather than assumed: Singapore's outline runs 49,641 units for an
 * official lap of 4,940 m, which is 10.05 units per metre. docs/OPENF1.md had
 * this as "units look like decimetres"; it is now a figure.
 */
export const UNITS_PER_METRE = 10;

/** Who is leading at `t`, by the latest position row at or before it. */
export function leaderAt(buffers: Buffers, t: number): number | null {
  for (const [n, rows] of buffers.pos) {
    const i = lastAtOrBefore(rows, t);
    if (i >= 0 && rows[i]![1] === 1) return n;
  }
  return null;
}

/**
 * The times the leader started a lap, which are the times they crossed the
 * line, oldest first.
 *
 * Taken from whoever leads at `t` rather than from each lap's own leader: the
 * viewer is watching one car come round, and a lead change mid-session should
 * not scatter the crossings between two cars.
 */
export function crossings(buffers: Buffers, t: number, since = 0): number[] {
  const leader = leaderAt(buffers, t);
  if (leader == null) return [];
  const laps = buffers.laps.get(leader);
  if (!laps) return [];
  return [...laps.values()]
    .map((l) => l.start)
    .filter((start): start is number => start != null && start >= since && start <= t)
    .sort((a, b) => a - b);
}

export interface NextCrossing {
  /** The leader's number, so the sheet can name them. */
  n: number;
  /** When they are next expected at the line, or null if that is unknowable. */
  at: number | null;
  /** How far they are from it, in metres, or null. */
  metres: number | null;
}

/**
 * Where the leader is in their lap, for the sheet's waiting state.
 *
 * Both figures are estimates and are described that way in the copy: the time
 * assumes this lap matches the last one, and the distance assumes they cover
 * what is left at an even rate.
 */
export function nextCrossing(buffers: Buffers, t: number, lapMetres: number | null): NextCrossing | null {
  const n = leaderAt(buffers, t);
  if (n == null) return null;
  const laps = buffers.laps.get(n);
  if (!laps) return { n, at: null, metres: null };

  // The lap in progress, and the most recent completed one to pace it by.
  let current: { start: number } | null = null;
  let lastDur: number | null = null;
  let lastEnd = -Infinity;
  for (const l of laps.values()) {
    if (l.start == null) continue;
    if (l.start <= t && (current == null || l.start > current.start)) current = { start: l.start };
    if (l.dur != null) {
      const end = l.start + l.dur * 1000;
      if (end <= t && end > lastEnd) {
        lastEnd = end;
        lastDur = l.dur;
      }
    }
  }
  if (!current || lastDur == null) return { n, at: null, metres: null };

  const elapsed = t - current.start;
  const remaining = Math.max(0, lastDur * 1000 - elapsed);
  const fraction = Math.min(1, elapsed / (lastDur * 1000));
  return {
    n,
    at: t + remaining,
    metres: lapMetres == null ? null : Math.round(lapMetres * (1 - fraction)),
  };
}

/**
 * The broadcast delay a tap implies: how long ago the leader really crossed.
 *
 * Clamped at both ends. The floor is four seconds because OpenF1's own data
 * arrives about three behind real time, so a smaller delay is not a delay
 * anyone can have; the ceiling keeps a mistimed tap from parking the whole
 * app three minutes in the past. A tap before any crossing is no answer at
 * all and says so, rather than guessing.
 */
export function delayFromTap(crossingTimes: readonly number[], tappedAt: number): number | null {
  let best: number | null = null;
  for (const c of crossingTimes) {
    if (c <= tappedAt && (best == null || c > best)) best = c;
  }
  if (best == null) return null;
  const seconds = (tappedAt - best) / 1000;
  return Math.min(MAX_DELAY_S, Math.max(MIN_DELAY_S, Math.round(seconds * 10) / 10));
}

/** The lap's length in metres, from the outline the circuit was built with. */
export function lapMetres(points: ReadonlyArray<readonly [number, number, number]>): number | null {
  if (points.length < 3) return null;
  let units = 0;
  for (let i = 1; i < points.length; i++) {
    units += Math.hypot(points[i]![0] - points[i - 1]![0], points[i]![1] - points[i - 1]![1]);
  }
  const first = points[0]!;
  const last = points[points.length - 1]!;
  units += Math.hypot(first[0] - last[0], first[1] - last[1]);
  return Math.round(units / UNITS_PER_METRE);
}
