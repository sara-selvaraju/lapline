// Building a frame from the buffers at a given clock.
//
// Positions are interpolated between the samples either side of the clock, so
// motion is smooth even though OpenF1 publishes at about 3.7 Hz. Timing rows,
// the track flag and lap state are derived here too; they move to derive/ at M4,
// when their rules change.
//
// Ported from reference/prototype/lib/feed.js.

import type {
  CarTuple,
  LiveMeta,
  Mode,
  RaceControlLine,
  ReplayMeta,
  Tick,
  TimingBlock,
  TowerRow,
  TrackFlag,
} from '@lapline/shared';
import { lastAtOrBefore, type Buffers } from './buffers.js';

/** A car is stale when its newest sample is older than this. */
export const STALE_MS = 8000;
/** Interpolate only when the next sample is closer than this. */
export const INTERP_GAP_MS = 2500;

export interface LapState {
  lap: number | null;
  last: number | null;
  best: number | null;
}

/**
 * The lap in progress, the most recently completed lap time, and the best lap
 * completed by `t`. Pit-out laps never count towards the best.
 */
export function currentLap(buffers: Buffers, n: number, t: number): LapState {
  const m = buffers.laps.get(n);
  if (!m) return { lap: null, last: null, best: null };
  let lap: number | null = null;
  let last: number | null = null;
  let lastEnd = -Infinity;
  let best: number | null = null;
  for (const l of m.values()) {
    if (l.start && l.start <= t && (lap == null || l.n > lap)) lap = l.n;
    if (l.start && l.dur) {
      const end = l.start + l.dur * 1000;
      if (end <= t) {
        if (end > lastEnd) {
          lastEnd = end;
          last = l.dur;
        }
        if (!l.pitOut && (best == null || l.dur < best)) best = l.dur;
      }
    }
  }
  return { lap, last, best };
}

export interface TyreState {
  tyre: string | null;
  age: number | null;
}

/** Compound and age for the stint covering this lap. */
export function tyre(buffers: Buffers, n: number, lap: number | null): TyreState {
  const m = buffers.stints.get(n);
  if (!m || lap == null) return { tyre: null, age: null };
  let found = null;
  for (const s of m.values()) if (s.start <= lap && (s.end == null || lap <= s.end)) found = s;
  if (!found) {
    // Before the stints feed catches up, fall back to the latest stint started.
    for (const s of m.values()) if (s.start <= lap && (!found || s.start > found.start)) found = s;
  }
  if (!found) return { tyre: null, age: null };
  return { tyre: found.compound, age: found.age0 + (lap - found.start) };
}

/**
 * The track flag at `t`, by replaying race control in order.
 *
 * Sector-scoped flags are ignored: they colour a marshal sector, not the track.
 * Marshal-sector flags and a proper state machine arrive in M3 and M5.
 */
export function trackFlag(buffers: Buffers, t: number): TrackFlag {
  let flag: TrackFlag = 'GREEN';
  for (const [rt, r] of buffers.rc) {
    if (rt > t) break;
    const msg = (r.message || '').toUpperCase();
    if (r.category === 'SafetyCar' || msg.includes('SAFETY CAR')) {
      if (msg.includes('VIRTUAL') && msg.includes('DEPLOYED')) flag = 'VSC';
      else if (msg.includes('DEPLOYED')) flag = 'SC';
      else if (msg.includes('ENDING') || msg.includes('IN THIS LAP')) {
        flag = flag === 'VSC' ? 'VSC ENDING' : 'SC ENDING';
      }
      continue;
    }
    if (r.category === 'Flag' && (r.scope === 'Track' || !r.scope)) {
      const f = (r.flag || '').toUpperCase();
      if (f === 'GREEN' || f === 'CLEAR') flag = 'GREEN';
      else if (f === 'RED') flag = 'RED';
      else if (f === 'CHEQUERED') flag = 'CHEQUERED';
      else if (f.includes('YELLOW')) flag = 'YELLOW';
    }
  }
  return flag;
}

/** Positions and telemetry for every car with a location sample at or before `t`. */
export function buildCars(buffers: Buffers, t: number): CarTuple[] {
  const cars: CarTuple[] = [];
  for (const [n, arr] of buffers.loc) {
    const i = lastAtOrBefore(arr, t);
    if (i < 0) continue;
    const a = arr[i]!;
    const b = arr[i + 1];
    let x = a[1];
    let y = a[2];
    let z = a[3];
    // Only interpolate across a short gap; a long one means missing data, not motion.
    if (b && b[0] - a[0] < INTERP_GAP_MS) {
      const f = (t - a[0]) / (b[0] - a[0]);
      x += (b[1] - a[1]) * f;
      y += (b[2] - a[2]) * f;
      z += (b[3] - a[3]) * f;
    }
    const stale = t - a[0] > STALE_MS ? 1 : 0;
    const ca = buffers.car.get(n);
    const ci = ca ? lastAtOrBefore(ca, t) : -1;
    const c = ci >= 0 ? ca![ci]! : null;
    // The car buffer holds speed, rpm, gear; the wire wants speed, gear, rpm.
    cars.push([
      n,
      Math.round(x),
      Math.round(y),
      Math.round(z),
      c ? c[1] ?? null : null,
      c ? c[3] ?? null : null,
      c ? c[2] ?? null : null,
      c ? c[4] ?? null : null,
      c ? c[5] ?? null : null,
      c ? c[6] ?? null : null,
      stale,
    ]);
  }
  return cars;
}

/** Tower rows, the leader's lap, the flag and the last four race control lines. */
export function buildTiming(buffers: Buffers, t: number): TimingBlock {
  const rows: TowerRow[] = [];
  let leaderLap: number | null = null;
  for (const d of buffers.drivers.values()) {
    const pa = buffers.pos.get(d.n);
    const pi = pa ? lastAtOrBefore(pa, t) : -1;
    const ia = buffers.ivl.get(d.n);
    const ii = ia ? lastAtOrBefore(ia, t) : -1;
    const lap = currentLap(buffers, d.n, t);
    const ty = tyre(buffers, d.n, lap.lap);
    const pits = buffers.pits.get(d.n);
    let inPit = false;
    if (pits) for (const [pt, dur] of pits) if (pt <= t && t <= pt + dur * 1000) inPit = true;
    const p = pi >= 0 ? pa![pi]![1] ?? null : null;
    if (p === 1) leaderLap = lap.lap;
    rows.push({
      n: d.n,
      p,
      gap: ii >= 0 ? ia![ii]![1] : null,
      int: ii >= 0 ? ia![ii]![2] : null,
      lap: lap.lap,
      last: lap.last,
      best: lap.best,
      tyre: ty.tyre,
      age: ty.age,
      pit: inPit,
    });
  }
  rows.sort((a, b) => (a.p ?? 99) - (b.p ?? 99));

  const rc: RaceControlLine[] = [];
  const k = lastAtOrBefore(buffers.rc, t);
  for (let j = k; j >= 0 && rc.length < 4; j--) {
    rc.push({ t: buffers.rc[j]![0], msg: buffers.rc[j]![1].message });
  }

  return { rows, lap: leaderLap, flag: trackFlag(buffers, t), rc };
}

export interface FrameMeta {
  mode: Mode;
  t: number;
  replay?: ReplayMeta | undefined;
  live?: LiveMeta | undefined;
}

/** A tick. Timing rides along on every fourth one, so it arrives at 1 Hz. */
export function buildFrame(buffers: Buffers, meta: FrameMeta, withTiming: boolean): Tick {
  const out: Tick = { t: meta.t, mode: meta.mode, cars: buildCars(buffers, meta.t) };
  if (meta.replay) out.replay = meta.replay;
  if (meta.live) out.live = meta.live;
  if (withTiming) out.timing = buildTiming(buffers, meta.t);
  return out;
}
