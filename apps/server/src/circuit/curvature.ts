// Turns derived from the shape of the lap itself.
//
// The fallback for when a meeting has no circuit file, or it cannot be
// fetched. This is the method the design mock-ups were made with: walk the
// outline, measure how sharply it turns, and call each local peak a corner.
//
// It gives positions and a count, not real corner numbers — those only come
// from the circuit file. Numbering here is simply the order they appear after
// the start line, which is what a viewer would guess anyway.

export type Point2 = { x: number; y: number };

export interface DerivedTurn {
  number: number;
  trackPosition: Point2;
}

/**
 * A corner turns tighter than this share of the circuit's own width.
 *
 * Curvature is 1/radius, so any absolute threshold is a threshold in whatever
 * units the coordinates happen to use — and OpenF1's vary. A fixed floor tuned
 * on one circuit admitted only 20 of 354 points at Singapore, which merged
 * down to 4 corners out of 19. Relative to the circuit's own size it works
 * anywhere.
 *
 * Calibrated against three shapes: a synthetic rounded rectangle (finds its 4
 * corners), a circle (finds none, correctly — it curves evenly) and a real
 * Singapore lap (finds 12, matching 11 of the 19 MultiViewer lists). Anything
 * from 0.2 to 0.4 behaves the same, so this is not a knife edge.
 *
 * Two thirds of a street circuit's corners is what this method is worth. It is
 * the fallback for when the circuit file is missing, not a replacement for it.
 */
const CORNER_RADIUS_FRACTION = 0.25;

/** The longer axis of the circuit, in whatever units the trace uses. */
function circuitSpan(points: readonly Point2[]): number {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  return Math.max(maxX - minX, maxY - minY);
}
/** Two peaks closer than this along the lap are one corner. */
const MIN_SEPARATION_FRACTION = 0.02;
/**
 * How much sharper a peak must be than the quietest point near it.
 *
 * A local maximum alone is not enough: on an evenly curving track every point
 * is one within floating-point noise, which produced twenty-three "corners" on
 * a test circle. But comparing against the whole lap's median is too blunt the
 * other way — on a street circuit most of the lap is cornering, so that found
 * only four of Singapore's nineteen. Prominence against the local minimum
 * handles both: a circle never dips, and a real corner always has something
 * straighter beside it.
 */
const PROMINENCE = 2;

/** Heading change per unit distance at each point, smoothed. */
export function curvature(points: readonly Point2[], window = 4): number[] {
  const n = points.length;
  const out = new Array<number>(n).fill(0);
  if (n < window * 2 + 1) return out;

  for (let i = 0; i < n; i++) {
    const a = points[(i - window + n) % n]!;
    const b = points[i]!;
    const c = points[(i + window) % n]!;
    const h1 = Math.atan2(b.y - a.y, b.x - a.x);
    const h2 = Math.atan2(c.y - b.y, c.x - b.x);
    let dh = Math.abs(h2 - h1);
    if (dh > Math.PI) dh = 2 * Math.PI - dh;
    const ds = Math.hypot(c.x - a.x, c.y - a.y);
    out[i] = ds > 0 ? dh / ds : 0;
  }
  return out;
}

/**
 * Corners, as local peaks in curvature. Peaks too close together are merged,
 * because a long corner produces a run of high curvature rather than one spike.
 */
export function turnsFromCurvature(points: readonly Point2[]): DerivedTurn[] {
  const n = points.length;
  if (n < 20) return [];
  const k = curvature(points);
  const minGap = Math.max(3, Math.floor(n * MIN_SEPARATION_FRACTION));
  const span = circuitSpan(points);
  if (span <= 0) return [];
  const minCurvature = 1 / (span * CORNER_RADIUS_FRACTION);
  // Wide enough to reach whatever straighter stretch sits beside a corner.
  const look = Math.max(minGap * 2, Math.floor(n * 0.05));

  const peaks: number[] = [];
  for (let i = 0; i < n; i++) {
    if (k[i]! < minCurvature) continue;

    let highest = true;
    let quietest = k[i]!;
    for (let j = 1; j <= look; j++) {
      const before = k[(i - j + n) % n]!;
      const after = k[(i + j) % n]!;
      if (j <= minGap && (before > k[i]! || after > k[i]!)) highest = false;
      if (before < quietest) quietest = before;
      if (after < quietest) quietest = after;
    }
    // Sharper than its neighbours, and sharper than the calm beside it.
    if (highest && k[i]! >= quietest * PROMINENCE) peaks.push(i);
  }

  // A plateau can still yield two equal neighbours; keep the first of any pair.
  const merged: number[] = [];
  for (const p of peaks) {
    const last = merged.at(-1);
    if (last == null || Math.min(p - last, n - (p - last)) >= minGap) merged.push(p);
  }

  return merged.map((i, idx) => ({ number: idx + 1, trackPosition: { x: points[i]!.x, y: points[i]!.y } }));
}
