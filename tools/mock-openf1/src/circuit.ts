// The synthetic circuit the mock drives cars around.
//
// A closed loop with three harmonics so it has real corners, a speed profile
// derived from its own curvature, and a cumulative time table so a lap fraction
// maps to a position. Ported from reference/prototype/mock/mock-openf1.js.

/** Samples around the loop. */
export const N = 1200;
const R = 6000;

/** The track, in OpenF1-like raw coordinates. */
export const P: Array<[number, number, number]> = [];
for (let i = 0; i < N; i++) {
  const th = (i / N) * Math.PI * 2;
  const r = R * (1 + 0.22 * Math.sin(2 * th) + 0.12 * Math.cos(3 * th) + 0.07 * Math.sin(5 * th + 0.4));
  P.push([
    Math.round(r * Math.cos(th) * 1.25),
    Math.round(r * Math.sin(th)),
    Math.round(40 + 28 * Math.sin(2 * th + 1) + 10 * Math.sin(7 * th)),
  ]);
}

interface Seg {
  ds: number;
  /** Curvature: heading change per unit distance. */
  k: number;
}

const seg: Seg[] = [];
for (let i = 0; i < N; i++) {
  const a = P[i]!;
  const b = P[(i + 1) % N]!;
  const c = P[(i + 2) % N]!;
  const ds = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const h1 = Math.atan2(b[1] - a[1], b[0] - a[0]);
  const h2 = Math.atan2(c[1] - b[1], c[0] - b[0]);
  let dh = Math.abs(h2 - h1);
  if (dh > Math.PI) dh = 2 * Math.PI - dh;
  seg.push({ ds, k: dh / Math.max(ds, 1) });
}

/** Speed at each sample, m/s: slow in the corners, smoothed six times. */
export let v: number[] = seg.map((s) => 25 + 63 * Math.exp(-s.k * 2500));
for (let pass = 0; pass < 6; pass++) {
  const prev = v;
  v = prev.map(
    (_, i) =>
      (prev[(i - 2 + N) % N]! + prev[(i - 1 + N) % N]! + prev[i]! + prev[(i + 1) % N]! + prev[(i + 2) % N]!) / 5,
  );
}

/** Cumulative lap time to each sample, seconds. */
export const cum: number[] = [0];
for (let i = 0; i < N; i++) cum.push(cum[i]! + seg[i]!.ds / (v[i]! * 10));

/** One lap, seconds, for a driver with pace factor 1. */
export const T0 = cum[N]!;

export interface MockDriver {
  n: number;
  code: string;
  name: string;
  team: string;
  col: string;
  /** Pace factor: lap time is T0 * f, so higher is slower. */
  f: number;
}

export interface MockSession {
  session_key: number;
  session_name: string;
  session_type: string;
  start: number;
  end: number;
  laps: number;
  meeting_key: number;
  circuit_key: number;
  circuit_short_name: string;
  country_name: string;
  location: string;
  year: number;
}

/**
 * The scripted red flag, as offsets from the session start.
 *
 * The session really is suspended for this window: cars stop where they are
 * and every lap after it shifts later by the same amount. Without that the
 * red-flag layout would be drawn over a field still racing, which tells us
 * nothing about whether the layout is right.
 */
export const RED_FROM_MS = 14 * 60_000;
export const RED_MS = 90_000;

/** How much of the window up to `dt` was spent suspended. */
export function suspendedBy(dt: number): number {
  if (dt <= RED_FROM_MS) return 0;
  return Math.min(RED_MS, dt - RED_FROM_MS);
}

/** Wall-clock offset to racing time: the clock the cars run on. */
export function racingOffset(dt: number): number {
  return dt - suspendedBy(dt);
}

/** Racing time back to a wall-clock offset, for scheduling laps and the flag. */
export function wallOffset(racing: number): number {
  return racing >= RED_FROM_MS ? racing + RED_MS : racing;
}

/** Progress in laps for a driver at a given time, capped at the session distance. */
export function progress(s: MockSession, d: MockDriver, t: number): number {
  const tau = racingOffset(t - s.start) / 1000 - (d.n - 2) * 0.3;
  if (tau < 0) return 0;
  return Math.min(tau / (T0 * d.f), s.laps);
}

/** Where a car sits at a given lap progress: the sample index and interpolated point. */
export function where(p: number): { i: number; x: number; y: number; z: number } {
  const frac = p - Math.floor(p);
  const target = frac * T0;
  let lo = 0;
  let hi = N;
  while (lo < hi - 1) {
    const m = (lo + hi) >> 1;
    if (cum[m]! <= target) lo = m;
    else hi = m;
  }
  const f = (target - cum[lo]!) / (cum[lo + 1]! - cum[lo]!);
  const a = P[lo]!;
  const b = P[(lo + 1) % N]!;
  return { i: lo, x: a[0] + (b[0] - a[0]) * f, y: a[1] + (b[1] - a[1]) * f, z: a[2] + (b[2] - a[2]) * f };
}

/**
 * A deterministic wobble on a driver's lap time, in seconds.
 *
 * Without this every driver laps to the same thousandth all race, so the
 * quickest car ties its own best every time round and the fastest lap of the
 * session never moves. That makes M4's acceptance check — purple on exactly
 * one row, only on the lap just completed — impossible to demonstrate.
 *
 * Deliberately deterministic, so the mock stays reproducible, and small
 * enough not to reorder the field.
 */
export function lapWobble(driverNumber: number, lap: number): number {
  const seed = Math.sin(driverNumber * 12.9898 + lap * 78.233) * 43758.5453;
  return +((seed - Math.floor(seed)) * 0.8 - 0.4).toFixed(3);
}

/** The lap each driver pits on, spread across the field. */
export function pitLap(d: MockDriver): number {
  return 6 + (d.n % 5);
}
