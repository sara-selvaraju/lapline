// Lap state: which lap a car is on, its last and best times, and whether that
// last lap was worth colouring.
//
// Moved here from feed/frames.ts at M4, which is where docs/ARCHITECTURE.md
// says these rules belong: pure functions over the buffers and a clock.

import type { Buffers } from '../feed/buffers.js';

export interface LapState {
  lap: number | null;
  last: number | null;
  best: number | null;
  /** When the last lap was completed, so a caller can tell how fresh it is. */
  lastEnd: number | null;
}

/**
 * The lap in progress, the most recently completed lap time, and the best lap
 * completed by `t`. Pit-out laps never count towards the best.
 */
export function currentLap(buffers: Buffers, n: number, t: number): LapState {
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
        if (!l.pitOut && (best == null || l.dur < best)) best = l.dur;
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
export function sessionBest(buffers: Buffers, t: number): number | null {
  let best: number | null = null;
  for (const m of buffers.laps.values()) {
    for (const l of m.values()) {
      if (l.pitOut || !l.start || !l.dur) continue;
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
 * about the best anyone holds. A pit-out lap never counts, matching `best`.
 */
export function lapColour(buffers: Buffers, n: number, t: number): LapFlag | null {
  const m = buffers.laps.get(n);
  if (!m) return null;

  // The lap this driver completed most recently, and whether it was a pit-out.
  let last: { dur: number; pitOut: boolean } | null = null;
  let lastEnd = -Infinity;
  for (const l of m.values()) {
    if (!l.start || !l.dur) continue;
    const end = l.start + l.dur * 1000;
    if (end <= t && end > lastEnd) {
      lastEnd = end;
      last = { dur: l.dur, pitOut: l.pitOut };
    }
  }
  if (!last || last.pitOut) return null;

  const best = sessionBest(buffers, t);
  if (best != null && last.dur <= best) return 'fastest';

  // A personal best means no earlier lap of theirs was quicker. Earlier, not
  // "other": equalling your own best on a later lap is not a new best.
  for (const l of m.values()) {
    if (l.pitOut || !l.start || !l.dur) continue;
    const end = l.start + l.dur * 1000;
    if (end <= t && end < lastEnd && l.dur <= last.dur) return null;
  }
  return 'pb';
}
