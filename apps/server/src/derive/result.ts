// The final classification, from OpenF1's own result for the session.
//
// Derived from `session_result` rather than from the last timing frame,
// because the two disagree about the things that matter at the end. A car
// that retired on lap 30 sits in the timing rows wherever its last position
// sample left it; the result says it did not finish. The gap in the timing
// rows is whatever the intervals feed last published; the result carries the
// official one. Points and disqualifications exist in neither.

import type { SessionResult, SessionResultRow } from '@lapline/shared';
import type { Buffers } from '../feed/buffers.js';
import { sessionBest } from './laps.js';

/** The driver and lap that set the session's fastest lap, for the finished screen. */
export function fastestLap(buffers: Buffers, t: number): SessionResult['fastest'] {
  const best = sessionBest(buffers, t);
  if (best == null) return null;
  for (const [n, laps] of buffers.laps) {
    for (const l of laps.values()) {
      if (l.pitOut || !l.start || !l.dur) continue;
      if (l.start + l.dur * 1000 > t) continue;
      if (l.dur === best) return { n, lap: l.n, time: best };
    }
  }
  return null;
}

/**
 * Turns upstream's result rows into the classification the client draws.
 *
 * Tolerant, like every other upstream read: a row without a driver number is
 * no use to anybody and is dropped, and anything else missing becomes null
 * rather than failing the whole block.
 */
export function classification(
  rows: readonly SessionResultRow[],
  buffers: Buffers,
  t: number,
): SessionResult {
  const out = rows
    .filter((r) => typeof r.driver_number === 'number')
    .map((r) => ({
      n: r.driver_number as number,
      position: typeof r.position === 'number' ? r.position : null,
      gap: typeof r.gap_to_leader === 'number' || typeof r.gap_to_leader === 'string' ? r.gap_to_leader : null,
      laps: typeof r.number_of_laps === 'number' ? r.number_of_laps : null,
      points: typeof r.points === 'number' ? r.points : null,
      status: r.dsq ? ('dsq' as const) : r.dns ? ('dns' as const) : r.dnf ? ('dnf' as const) : ('finished' as const),
    }))
    // Classified first in order, then the cars that did not finish, which is
    // how the artboard lists them: a DNF has no position to sort by.
    .sort((a, b) => (a.position ?? 999) - (b.position ?? 999));

  const winner = out.find((r) => r.position === 1);
  const winnerRow = winner ? rows.find((r) => r.driver_number === winner.n) : undefined;

  return {
    rows: out,
    winnerTime: typeof winnerRow?.duration === 'number' ? winnerRow.duration : null,
    fastest: fastestLap(buffers, t),
  };
}
