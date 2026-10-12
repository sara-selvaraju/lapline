// Building a frame from the buffers at a given clock.
//
// Positions are interpolated between the samples either side of the clock, so
// motion is smooth even though OpenF1 publishes at about 3.7 Hz. Everything
// else here is assembly: the rules themselves live in derive/, as pure
// functions over the buffers and a clock, so they can be tested on their own.
//
// Ported from reference/prototype/lib/feed.js.

import type {
  CarTuple,
  LiveMeta,
  MarshalSectorFlag,
  Mode,
  RaceControlLine,
  ReplayMeta,
  SectorFlag,
  Tick,
  Timing,
  TowerRow,
  TrackFlag,
} from '@lapline/shared';
import { lastAtOrBefore, type Buffers } from './buffers.js';
import { battles } from '../derive/battles.js';
import { currentLap, lapColour } from '../derive/laps.js';
import { marshalSectorFlags, trackFlag } from '../derive/flags.js';
import { tyre } from '../derive/tyres.js';

// Re-exported because the frame builders are the only callers outside derive/,
// and the tests for each rule live beside it now.
export { currentLap, lapColour, marshalSectorFlags, trackFlag, tyre, battles };

/** A car is stale when its newest sample is older than this. */
export const STALE_MS = 8000;
/** Interpolate only when the next sample is closer than this. */
export const INTERP_GAP_MS = 2500;

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

/**
 * Tower rows, the leader's lap, the flag, the last four race control lines,
 * the marshal sectors showing a flag and who is in a battle. Sent at 1 Hz as
 * its own event. `totalLaps` stays null because OpenF1 publishes none.
 */
export function buildTiming(buffers: Buffers, t: number): Timing {
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
      lapFlag: lapColour(buffers, d.n, t),
    });
  }
  rows.sort((a, b) => (a.p ?? 99) - (b.p ?? 99));

  const rc: RaceControlLine[] = [];
  const k = lastAtOrBefore(buffers.rc, t);
  for (let j = k; j >= 0 && rc.length < 4; j--) {
    rc.push({ t: buffers.rc[j]![0], msg: buffers.rc[j]![1].message ?? '' });
  }

  return {
    t,
    rows,
    lap: leaderLap,
    // OpenF1 publishes no total-lap figure, so there is nothing honest to send.
    totalLaps: null,
    flag: trackFlag(buffers, t),
    marshalSectors: marshalSectorFlags(buffers, t),
    rc,
    battles: battles(buffers, t),
  };
}

export interface FrameMeta {
  mode: Mode;
  t: number;
  replay?: ReplayMeta | undefined;
  live?: LiveMeta | undefined;
}

/** 4 Hz. Timing is a separate event now, so this carries no tower rows. */
export function buildTick(buffers: Buffers, meta: FrameMeta): Tick {
  const out: Tick = { t: meta.t, mode: meta.mode, cars: buildCars(buffers, meta.t) };
  if (meta.replay) out.replay = meta.replay;
  if (meta.live) out.live = meta.live;
  return out;
}
