// The track outline.
//
// The outline is the position trace of the fastest clean lap. During a live
// session with no completed laps yet, an earlier session of the same meeting is
// used instead, because its laps are finished. Everything here is pure; the
// fetching lives in the Feed.
//
// Ported from reference/prototype/lib/feed.js. Turn numbers, sectors, marshal
// sectors and the pit lane arrive in M3, in circuit/.

import type { SessionRow, Transform } from '@lapline/shared';

export type Point = [x: number, y: number, z: number];

/** How long to wait before trying the outline again after a failed attempt. */
export const TRACK_RETRY_MS = 45_000;

export interface LapCandidate {
  driver: number;
  n: number;
  start: number | null;
  dur: number | null;
  pitOut: boolean;
  sectors?: { s1: number; s2: number; s3: number } | null;
}

/**
 * How much of a trace must be distinct positions, as a fraction.
 *
 * Calibrated against fourteen 2026 circuits, which all sit at 99-100%.
 * Hungary 2026 sits at 8%: its position feed repeats the same 26 points
 * around the whole lap, so x and y freeze while z keeps counting. That trace
 * has plenty of rows and passes a row count, which is how it reached the
 * outline and put corners 11% of the circuit away from where they belong.
 */
const MIN_DISTINCT_FRACTION = 0.6;

/**
 * The largest step between consecutive samples, as a fraction of the
 * circuit's longer axis. The same fourteen circuits span 3.5% to 6.1%, the
 * high end being a tight circuit where 4 Hz covers more of a small lap.
 * Hungary's frozen trace jumps 28.7% when it catches up.
 */
const MAX_STEP_FRACTION = 0.15;

/** Fewest points worth calling an outline. */
const MIN_TRACE_POINTS = 50;

/**
 * Whether a position trace is good enough to draw a circuit from.
 *
 * Row count alone is not enough. Upstream sometimes serves a full set of rows
 * whose positions barely change, and a bad outline is worse than none: every
 * corner, sector and pit lane is placed against it, so it does not fail
 * visibly, it just puts everything slightly wrong.
 */
export function usableTrace(points: readonly Point[]): { ok: boolean; reason?: string } {
  if (points.length < MIN_TRACE_POINTS) return { ok: false, reason: `only ${points.length} points` };

  const distinct = new Set(points.map((p) => `${p[0]},${p[1]}`)).size;
  const fraction = distinct / points.length;
  if (fraction < MIN_DISTINCT_FRACTION) {
    return { ok: false, reason: `only ${distinct} distinct positions in ${points.length} rows` };
  }

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const [x, y] of points) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const span = Math.max(maxX - minX, maxY - minY);
  if (!(span > 0)) return { ok: false, reason: 'the trace has no extent' };

  let step = 0;
  for (let i = 1; i < points.length; i++) {
    step = Math.max(step, Math.hypot(points[i]![0] - points[i - 1]![0], points[i]![1] - points[i - 1]![1]));
  }
  if (step > span * MAX_STEP_FRACTION) {
    return { ok: false, reason: `a ${Math.round((step / span) * 100)}% jump between samples` };
  }
  return { ok: true };
}

/**
 * The fastest lap worth tracing: it has a start and a duration, is not a pit-out
 * lap, is not the opening lap, and is longer than 40 s so a timing glitch cannot
 * win.
 */
export function pickReferenceLap(laps: readonly LapCandidate[]): LapCandidate | null {
  return rankedReferenceLaps(laps, 1)[0] ?? null;
}

/**
 * The best laps to trace, fastest first.
 *
 * More than one, because the fastest lap's positions are sometimes unusable
 * and the next lap's are fine. Kept short: each one tried costs a request.
 */
export function rankedReferenceLaps(laps: readonly LapCandidate[], limit = 3): LapCandidate[] {
  return laps
    .filter((l) => l.start && l.dur && !l.pitOut && l.n > 1 && (l.dur as number) > 40)
    .sort((a, b) => (a.dur as number) - (b.dur as number))
    .slice(0, limit);
}

/**
 * Sessions to try for an outline, best first. A live session prefers a finished
 * session from the same meeting, since its laps are complete.
 *
 * Note the ordering: unshifting while walking a newest-first list puts the
 * *earliest* finished session of the weekend first, so a live race takes its
 * outline from FP1 rather than qualifying — a complete lap, but a slower one.
 * Carried over from the prototype; M3 owns the outline.
 */
export function trackCandidates(
  session: SessionRow,
  sessions: readonly SessionRow[],
  mode: string,
  now: number = Date.now(),
): SessionRow[] {
  const candidates: SessionRow[] = [session];
  if (mode === 'live') {
    for (const o of sessions) {
      if (
        o.meeting_key === session.meeting_key &&
        o.session_key !== session.session_key &&
        Date.parse(o.date_end as string) < now
      ) {
        candidates.unshift(o);
      }
    }
  }
  return candidates;
}

/**
 * Light smoothing on z, which is noisy at about 4 Hz. The window wraps, which is
 * right for a closed lap and leaves a small seam at the start/finish line.
 */
export function smoothZ(raw: readonly Point[]): Point[] {
  const n = raw.length;
  return raw.map((p, i) => {
    let zs = 0;
    let c = 0;
    for (let k = -3; k <= 3; k++) {
      const q = raw[(i + k + n) % n]!;
      zs += q[2];
      c++;
    }
    return [p[0], p[1], Math.round(zs / c)] as Point;
  });
}

/** Centre, floor and scale: 100 world units across the track's longer axis. */
export function transformFor(pts: readonly Point[]): Transform {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let minZ = Infinity;
  for (const [x, y, z] of pts) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    if (z < minZ) minZ = z;
  }
  const span = Math.max(maxX - minX, maxY - minY) || 1;
  return { cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, cz: minZ, scale: 100 / span };
}
