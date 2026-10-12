// Geometry for the 30-second speed trace.
//
// Kept apart from the component so the maths can be tested without a DOM,
// which is how everything else in apps/web is tested. Sizes come from
// design/artboards/DriverDetail.dc.html: a 358 x 92 box with dashed
// gridlines at 300 and 150 km/h, and braking marked along the bottom.

import type { HistorySample } from '../store/store.js';

export const TRACE_W = 358;
export const TRACE_H = 92;
/** The window the caption promises. */
export const TRACE_MS = 30_000;

/** The artboard's two gridlines, which also fix the speed-to-y mapping. */
export const GRID = [
  { speed: 300, y: 14 },
  { speed: 150, y: 54 },
] as const;

/** Braking bars sit here, clear of the trace. */
export const BRAKE_Y = 84;
export const BRAKE_H = 6;
const TRACE_TOP = 2;
const TRACE_BOTTOM = 80;

/** Speed in km/h to a y inside the box, clamped so a wild sample cannot escape. */
export function traceY(speed: number): number {
  const [a, b] = GRID;
  const y = a.y + ((a.speed - speed) * (b.y - a.y)) / (a.speed - b.speed);
  return Math.max(TRACE_TOP, Math.min(TRACE_BOTTOM, y));
}

export interface TraceShape {
  /** An SVG path, or null when there is not yet enough to draw a line. */
  path: string | null;
  /** Braking runs as [x, width] pairs. */
  braking: Array<[x: number, width: number]>;
  /** How much of the window has filled, 0 to 1, for the "still filling" note. */
  filled: number;
}

/**
 * Turns the recorded samples into a path and the braking runs beneath it.
 *
 * The window ends at the newest sample rather than at the wall clock, so a
 * paused replay keeps showing the last thing that happened instead of the
 * trace sliding away to the left.
 */
export function traceShape(history: readonly HistorySample[]): TraceShape {
  const empty: TraceShape = { path: null, braking: [], filled: 0 };
  if (history.length === 0) return empty;

  const end = history[history.length - 1]![0];
  const start = end - TRACE_MS;
  const window = history.filter(([t]) => t >= start);
  const x = (t: number): number => ((t - start) / TRACE_MS) * TRACE_W;

  const points = window
    .filter((s): s is [number, number, number | null, number | null] => typeof s[1] === 'number')
    .map(([t, speed]) => `${x(t).toFixed(1)} ${traceY(speed).toFixed(1)}`);

  const braking: Array<[number, number]> = [];
  let from: number | null = null;
  for (const [t, , , brake] of window) {
    if (brake != null && brake > 0) {
      if (from == null) from = t;
    } else if (from != null) {
      braking.push([x(from), Math.max(1, x(t) - x(from))]);
      from = null;
    }
  }
  if (from != null) braking.push([x(from), Math.max(1, x(end) - x(from))]);

  return {
    path: points.length >= 2 ? `M${points.join('L')}` : null,
    braking,
    filled: Math.min(1, (end - window[0]![0]) / TRACE_MS),
  };
}
