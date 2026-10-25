// What kind of session this is, and the tower's numbers for the timed ones.
//
// A race is ordered by who is ahead on the road; practice and qualifying by
// the best lap that counts. So the tower shows an interval and the last lap
// in one, and the gap to the fastest and each best lap in the other. The
// server decides which laps count (derive/qualifying.ts); this only reads
// the rows it sends.

import type { SessionResult, Timing, TowerRow } from '@lapline/shared';
import { fmtGap } from './format.js';

export type SessionKind = 'race' | 'practice' | 'qualifying';

/**
 * From OpenF1's session name: 'Race', 'Sprint', 'Qualifying', 'Sprint
 * Qualifying', 'Practice 1' and so on. Older sprint weekends called sprint
 * qualifying a shootout. Anything unrecognised is treated as a race, which is
 * what the tower showed for every session before this.
 */
export function sessionKind(name: string | null | undefined): SessionKind {
  const s = (name ?? '').toLowerCase();
  if (s.includes('qualifying') || s.includes('shootout')) return 'qualifying';
  if (s.includes('practice')) return 'practice';
  return 'race';
}

/** How the header names a timed session: "Qualifying Q2", "Practice 2". */
export function sessionLabel(name: string | null | undefined, phase: number | null): { text: string; bold: string } | null {
  const kind = sessionKind(name);
  if (kind === 'practice') {
    const n = /(\d+)/.exec(name ?? '')?.[1];
    return { text: 'Practice', bold: n ?? '' };
  }
  if (kind === 'qualifying') {
    const sprint = /sprint|shootout/i.test(name ?? '');
    return { text: sprint ? 'Sprint qualifying' : 'Qualifying', bold: phase ? `${sprint ? 'SQ' : 'Q'}${phase}` : '' };
  }
  return null;
}

/**
 * The fastest best lap among the drivers still running, which is the time
 * every gap is measured from and the one that stays purple. Knocked-out
 * drivers' times are from an earlier segment and are not in the running.
 */
export function fastestBest(rows: readonly TowerRow[]): number | null {
  let best: number | null = null;
  for (const r of rows) {
    if (r.outIn != null || r.best == null) continue;
    if (best == null || r.best < best) best = r.best;
  }
  return best;
}

/** The gap column in a timed session: "Fastest", "+0.068", "No time", or blank once out. */
export function timedGap(row: TowerRow, fastest: number | null): string {
  if (row.outIn != null) return '';
  if (row.best == null || fastest == null) return 'No time';
  if (row.best <= fastest) return 'Fastest';
  return fmtGap(row.best - fastest, null);
}

/**
 * Whether to show the finished screen: a race under the chequered flag, with
 * its classification in.
 *
 * Races only. The podium, "Gap to winner" and the stops column are a race's
 * ending; qualifying's result carries three times a driver and no single gap,
 * and its chequered flag also falls at the end of Q1 and Q2, so the screen
 * came and went between segments. In practice and qualifying the timed tower
 * stays up instead, and by the flag it already matches the official order.
 */
export function showsFinished(s: { session: { name: string } | null; timing: Timing | null; result: SessionResult | null }): boolean {
  return s.timing?.flag === 'CHEQUERED' && s.result != null && sessionKind(s.session?.name) === 'race';
}
