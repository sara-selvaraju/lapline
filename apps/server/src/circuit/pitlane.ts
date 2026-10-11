// The pit lane, derived from a car's own position trace through a stop.
//
// Neither OpenF1 nor the circuit file publishes a pit-lane path. What we do
// have is `pit`, which says when a car was in the lane and for how long, and
// `location`, which says where it was. A car serving a stop drives the one
// piece of tarmac that is not the racing line, so the lane falls out of the
// trace: take the stop window, drop every sample that lies on the outline, and
// what is left is the lane.
//
// Measuring "on the outline" needs care. The outline is sampled at about
// 3.7 Hz, so its points sit tens of units apart on a straight and much further
// at speed. Distance to the nearest outline *point* therefore measures the
// sampling gap as much as any lateral offset, and on a real Singapore lap it
// reaches 396 units with the car on the racing line the whole way. Distance to
// the nearest outline *segment* is the actual perpendicular offset: the same
// lap never exceeds 42 units, while the lap with the stop sits at 117. That is
// the separation this module relies on.

import type { Point3 } from '@lapline/shared';

/**
 * How far off the outline a sample must sit to count as being in the pit lane,
 * as a fraction of the circuit's longer axis.
 *
 * Scale-relative for the same reason the corner threshold is: coordinates are
 * in whatever units the circuit happens to use, so an absolute figure is a
 * figure about one circuit. At Singapore 0.4% is 57 units, which clears the
 * 42 a racing lap reached and sits well under the 117 the pit lap held.
 */
const PIT_OFFSET_FRACTION = 0.004;

/** Shortest run worth drawing, in samples. A handful of stray points is noise. */
const MIN_RUN_POINTS = 20;

/**
 * Shortest path worth drawing, as a fraction of the circuit's longer axis. A
 * pit lane runs alongside the main straight, so it is a sizeable share of the
 * circuit: Singapore's comes out at 47%. Anything very short is a car running
 * wide, not a lane.
 */
const MIN_PATH_FRACTION = 0.1;

/** Samples closer together than this, relative to the span, are the same place. */
const DEDUPE_FRACTION = 0.0004;

export interface PitStop {
  driver: number;
  /** When the car left the lane, as upstream reports it. */
  at: number;
  /** How long it was in the lane, in seconds. */
  laneDurationS: number;
}

/**
 * Plausible stops, best first.
 *
 * A stop is worth tracing if its lane duration is long enough to be a real
 * stop and short enough not to be a retirement or a red-flag queue. Later
 * stops are preferred: by then the field has settled, so the trace is less
 * likely to catch a car weaving past a queue on pit entry.
 */
export function pickPitStops(stops: readonly PitStop[]): PitStop[] {
  return stops
    .filter((s) => s.laneDurationS >= 15 && s.laneDurationS <= 60)
    .sort((a, b) => b.at - a.at);
}

/** The window of location to ask for, covering the lane plus a little either side. */
export function stopWindow(stop: PitStop, marginMs = 20_000): { from: number; to: number } {
  return { from: stop.at - stop.laneDurationS * 1000 - marginMs, to: stop.at + marginMs };
}

/** The longer axis of a set of points. */
function spanOf(points: readonly Point3[]): number {
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
  return Math.max(maxX - minX, maxY - minY) || 1;
}

/** Perpendicular distance from a point to a segment, ignoring elevation. */
function segmentDistance(p: Point3, a: Point3, b: Point3): number {
  const vx = b[0] - a[0];
  const vy = b[1] - a[1];
  const wx = p[0] - a[0];
  const wy = p[1] - a[1];
  const len = vx * vx + vy * vy;
  let t = len > 0 ? (wx * vx + wy * vy) / len : 0;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  return Math.hypot(p[0] - (a[0] + t * vx), p[1] - (a[1] + t * vy));
}

/**
 * How far a point sits off the outline. The outline is a closed lap, so the
 * last segment wraps back to the first.
 */
export function offsetFromOutline(outline: readonly Point3[], p: Point3): number {
  if (outline.length === 0) return Infinity;
  if (outline.length === 1) return Math.hypot(p[0] - outline[0]![0], p[1] - outline[0]![1]);
  let best = Infinity;
  for (let i = 0; i < outline.length; i++) {
    const d = segmentDistance(p, outline[i]!, outline[(i + 1) % outline.length]!);
    if (d < best) best = d;
  }
  return best;
}

/** Light non-wrapping average on z. The lane is an open path, so the ends hold. */
function smoothOpenZ(points: readonly Point3[]): Point3[] {
  return points.map((p, i) => {
    let total = 0;
    let count = 0;
    for (let k = -3; k <= 3; k++) {
      const q = points[i + k];
      if (q) {
        total += q[2];
        count++;
      }
    }
    return [p[0], p[1], Math.round(total / count)] as Point3;
  });
}

/**
 * The pit lane from one stop's position trace, or an empty path if the trace
 * does not clearly contain one.
 *
 * The trace must be in time order. Returning nothing is a normal outcome: a
 * lane drawn in the wrong place is worse than no lane, so every gate here
 * fails closed.
 */
export function pitLaneFromTrace(outline: readonly Point3[], trace: readonly Point3[]): Point3[] {
  if (outline.length < 3 || trace.length === 0) return [];
  const span = spanOf(outline);
  const threshold = span * PIT_OFFSET_FRACTION;

  // The longest unbroken stretch of samples that sit off the outline. One run,
  // because a car serves a stop once: several runs means we are looking at
  // something else, so the longest is the best guess and the gates below judge
  // whether it is good enough.
  let bestFrom = -1;
  let bestTo = -1;
  let from = -1;
  for (let i = 0; i <= trace.length; i++) {
    const off = i < trace.length && offsetFromOutline(outline, trace[i]!) > threshold;
    if (off) {
      if (from < 0) from = i;
    } else if (from >= 0) {
      if (i - from > bestTo - bestFrom) {
        bestFrom = from;
        bestTo = i;
      }
      from = -1;
    }
  }
  if (bestFrom < 0 || bestTo - bestFrom < MIN_RUN_POINTS) return [];

  // Drop repeats, so the seconds spent stationary in the box are one point.
  const minStep = span * DEDUPE_FRACTION;
  const path: Point3[] = [];
  for (let i = bestFrom; i < bestTo; i++) {
    const p = trace[i]!;
    const last = path[path.length - 1];
    if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) > minStep) path.push(p);
  }
  if (path.length < 2) return [];

  let length = 0;
  for (let i = 1; i < path.length; i++) {
    length += Math.hypot(path[i]![0] - path[i - 1]![0], path[i]![1] - path[i - 1]![1]);
  }
  if (length < span * MIN_PATH_FRACTION) return [];

  return smoothOpenZ(path);
}
