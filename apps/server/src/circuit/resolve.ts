// Placing circuit detail onto our own outline.
//
// The circuit file gives corners and marshal sectors as coordinates; the
// protocol carries them as indices into the outline. Resolving here means the
// client gets the exact 3D position and local direction for free, detail stays
// correct when the elevation setting changes, and the wire stays small.

import type { Point3, SectorBoundary, TrackMarker } from '@lapline/shared';
import type { CircuitMarker } from './multiviewer.js';
import { turnsFromCurvature, type Point2 } from './curvature.js';

/** The outline point closest to a coordinate, ignoring elevation. */
export function nearestIndex(points: readonly Point3[], x: number, y: number): number {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < points.length; i++) {
    const p = points[i]!;
    const d = (p[0] - x) ** 2 + (p[1] - y) ** 2;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

/** Markers from the circuit file, placed on the outline and ordered by lap position. */
export function resolveMarkers(points: readonly Point3[], markers: readonly CircuitMarker[]): TrackMarker[] {
  if (points.length === 0) return [];
  return markers
    .map((m) => ({ number: m.number, index: nearestIndex(points, m.trackPosition.x, m.trackPosition.y) }))
    .sort((a, b) => a.index - b.index);
}

/** Turns from the lap's own shape, for when the circuit file is unavailable. */
export function turnsFromOutline(points: readonly Point3[]): TrackMarker[] {
  const flat: Point2[] = points.map((p) => ({ x: p[0], y: p[1] }));
  return turnsFromCurvature(flat).map((t) => ({
    number: t.number,
    index: nearestIndex(points, t.trackPosition.x, t.trackPosition.y),
  }));
}

export interface SectorDurations {
  s1: number;
  s2: number;
  s3: number;
}

/**
 * Where the timing sectors change, from a reference lap's sector times.
 *
 * Neither OpenF1 nor the circuit file publishes sector positions. The outline
 * is a position trace of one lap sampled at a steady rate, so an index is very
 * nearly a time along that lap: sector one ends at its share of the lap time,
 * and so on. S1 sits at the start line because that is where the lap begins.
 *
 * This assumes even sampling, which OpenF1's roughly 3.7 Hz gives but does not
 * guarantee, so the boundaries are approximate. A sector tick a car-length out
 * is not worth dropping the layer over; a boundary in the wrong corner would
 * be, which is what the Singapore check is for.
 */
export function sectorBoundaries(
  pointCount: number,
  durations: SectorDurations | null,
): SectorBoundary[] {
  if (pointCount < 3 || !durations) return [];
  const { s1, s2, s3 } = durations;
  const total = s1 + s2 + s3;
  if (!(total > 0)) return [];
  const at = (seconds: number): number =>
    Math.min(pointCount - 1, Math.max(0, Math.round((seconds / total) * (pointCount - 1))));
  return [
    { label: 'S1', index: 0 },
    { label: 'S2', index: at(s1) },
    { label: 'S3', index: at(s1 + s2) },
  ];
}
