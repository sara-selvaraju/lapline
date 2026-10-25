// Lap state: which lap a car is on, its last and best times, and whether that
// last lap was worth colouring.
//
// Moved here from feed/frames.ts at M4, which is where docs/ARCHITECTURE.md
// says these rules belong: pure functions over the buffers and a clock.

import type { Buffers, Lap } from '../feed/buffers.js';

/**
 * Which laps count towards a best: those started inside a window, less any
 * that race control has deleted. Pit-out laps never count.
 *
 * A race or a practice session is one window, the whole session. Qualifying
 * is one per segment, because the tower is ordered by the segment a driver is
 * in (see derive/qualifying.ts), and a Q1 lap has no say in Q3.
 */
export interface LapScope {
  from: number;
  to: number;
  /** `driver|lap` keys, from `deletedLaps`. */
  deleted: ReadonlySet<string>;
}

export const WHOLE_SESSION: LapScope = { from: -Infinity, to: Infinity, deleted: new Set() };

/** Whether a completed lap counts towards a best under `scope`. */
function counts(n: number, l: Lap, scope: LapScope): l is Lap & { start: number; dur: number } {
  if (l.pitOut || !l.start || !l.dur) return false;
  if (l.start < scope.from || l.start >= scope.to) return false;
  return !scope.deleted.has(`${n}|${l.n}`);
}

/** Reads "TIME 1:36.764" out of a deletion message, in seconds. */
const TIME = /\bTIME (\d+):(\d+(?:\.\d+)?)/;
const CAR = /^CAR (\d+)\b/;
const LAP = /\bLAP (\d+)\b/;

/**
 * Laps race control has deleted by `t`, as `driver|lap` keys.
 *
 * OpenF1 leaves a deleted lap's time in `laps`, so without this a time
 * deleted for track limits stays someone's best and the tower's times stop
 * matching its order: at Austin 2026 BEA's Q2 would have read 1:35.592, which
 * was deleted, against an official 1:36.031.
 *
 * Race control's lap number is not OpenF1's. "CAR 10 (GAS) TIME 1:36.764
 * DELETED ... LAP 3" is issued while the car is on its next lap, and the
 * 1:36.764 is OpenF1's lap 2. Every deletion in that session was the lap
 * before the one named, and the time matched to the millisecond, so the time
 * is matched where the message has one and the lap before otherwise.
 */
export function deletedLaps(buffers: Buffers, t: number): Set<string> {
  const out = new Set<string>();
  for (const [rt, r] of buffers.rc) {
    if (rt > t) break;
    const msg = (r.message || '').toUpperCase();
    const deleted = msg.includes('DELETED');
    if (!deleted && !msg.includes('REINSTATED')) continue;
    const car = CAR.exec(msg);
    const lapNo = LAP.exec(msg);
    if (!car || !lapNo) continue;
    const n = Number(car[1]);
    const laps = buffers.laps.get(n);
    if (!laps) continue;

    let lap: number | null = null;
    const time = TIME.exec(msg);
    if (time) {
      const secs = Number(time[1]) * 60 + Number(time[2]);
      for (const l of laps.values()) {
        if (l.dur != null && Math.abs(l.dur - secs) < 0.0015) lap = l.n;
      }
    }
    if (lap == null) lap = Number(lapNo[1]) - 1;

    if (deleted) out.add(`${n}|${lap}`);
    else out.delete(`${n}|${lap}`);
  }
  return out;
}

export interface LapState {
  lap: number | null;
  last: number | null;
  best: number | null;
  /** When the last lap was completed, so a caller can tell how fresh it is. */
  lastEnd: number | null;
}

/**
 * The lap in progress, the most recently completed lap time, and the best lap
 * completed by `t` among those `scope` counts.
 */
export function currentLap(buffers: Buffers, n: number, t: number, scope: LapScope = WHOLE_SESSION): LapState {
  const m = buffers.laps.get(n);
  if (!m) return { lap: null, last: null, best: null, lastEnd: null };
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
        if (counts(n, l, scope) && (best == null || l.dur < best)) best = l.dur;
      }
    }
  }
  return { lap, last, best, lastEnd: lastEnd === -Infinity ? null : lastEnd };
}

/** What colour the last lap deserves, if any. */
export type LapFlag = 'fastest' | 'pb';

/**
 * The fastest lap anyone has completed by `t`.
 *
 * Over the whole lap history, not over the drivers presently in the tower: a
 * driver who retires does not un-set the fastest lap of the session, and the
 * tower would otherwise promote someone else's time to purple the moment they
 * dropped out.
 */
export function sessionBest(buffers: Buffers, t: number, scope: LapScope = WHOLE_SESSION): number | null {
  let best: number | null = null;
  for (const [n, m] of buffers.laps) {
    for (const l of m.values()) {
      if (!counts(n, l, scope)) continue;
      if (l.start + l.dur * 1000 > t) continue;
      if (best == null || l.dur < best) best = l.dur;
    }
  }
  return best;
}

/**
 * Whether this driver's last lap is worth colouring, and how.
 *
 * docs/DESIGN.md: purple only for the session's fastest lap and `pb` only for
 * a personal best, "each on the lap just completed". That last clause is the
 * whole point and is why this cannot be a comparison of values in the view: a
 * driver who set the fastest lap an hour ago still has it as their `best`, and
 * their row should go back to plain the moment they cross the line slower.
 *
 * So the question asked is about the lap that has just been completed, not
 * about the best anyone holds. A lap `scope` does not count is never
 * coloured, matching `best`: a pit-out, a deleted lap, or in qualifying a lap
 * from a segment that is over.
 */
export function lapColour(buffers: Buffers, n: number, t: number, scope: LapScope = WHOLE_SESSION): LapFlag | null {
  const m = buffers.laps.get(n);
  if (!m) return null;

  // The lap this driver completed most recently, and whether it counts.
  let last: Lap | null = null;
  let lastEnd = -Infinity;
  for (const l of m.values()) {
    if (!l.start || !l.dur) continue;
    const end = l.start + l.dur * 1000;
    if (end <= t && end > lastEnd) {
      lastEnd = end;
      last = l;
    }
  }
  if (!last || !counts(n, last, scope)) return null;

  const best = sessionBest(buffers, t, scope);
  if (best != null && last.dur <= best) return 'fastest';

  // A personal best means no earlier lap of theirs was quicker. Earlier, not
  // "other": equalling your own best on a later lap is not a new best.
  for (const l of m.values()) {
    if (!counts(n, l, scope)) continue;
    const end = l.start + l.dur * 1000;
    if (end <= t && end < lastEnd && l.dur <= last.dur) return null;
  }
  return 'pb';
}
