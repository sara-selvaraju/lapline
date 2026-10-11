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
 * The fastest lap worth tracing: it has a start and a duration, is not a pit-out
 * lap, is not the opening lap, and is longer than 40 s so a timing glitch cannot
 * win.
 */
export function pickReferenceLap(laps: readonly LapCandidate[]): LapCandidate | null {
  const valid = laps
    .filter((l) => l.start && l.dur && !l.pitOut && l.n > 1 && (l.dur as number) > 40)
    .sort((a, b) => (a.dur as number) - (b.dur as number));
  return valid[0] ?? null;
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
