// Qualifying segments: which one is running, and who has been knocked out.
//
// OpenF1 orders a qualifying tower by the segment each driver is in, so its
// times have to come from that segment too. At Austin 2026 NOR was eighth in
// Q3 on 1:35.049, while his 1:34.539 from Q2 would have put him third; a
// whole-session best shows times that disagree with the order beside them.

import { qualifyingCut } from '@lapline/shared';
import { lastAtOrBefore, type Buffers } from '../feed/buffers.js';
import type { LapScope } from './laps.js';

export interface Segment {
  phase: number;
  from: number;
  /** When the next segment started, or Infinity while this one is the last. */
  to: number;
}

/**
 * The segments started by `t`, in order.
 *
 * Race control tags its rows with `qualifying_phase` in qualifying and sprint
 * qualifying only, and opens each segment with SESSION STARTED. A red flag
 * restarts a segment with another SESSION STARTED under the same phase, so a
 * segment begins at the first row that names it. Empty for any other session.
 */
export function segments(buffers: Buffers, t: number): Segment[] {
  const starts = new Map<number, number>();
  for (const [rt, r] of buffers.rc) {
    if (rt > t) break;
    const phase = r.qualifying_phase;
    if (typeof phase !== 'number' || starts.has(phase)) continue;
    if (r.category === 'SessionStatus' || (r.message || '').toUpperCase().includes('SESSION STARTED')) {
      starts.set(phase, rt);
    }
  }
  const out = [...starts]
    .sort((a, b) => a[0] - b[0])
    .map(([phase, from]) => ({ phase, from, to: Infinity }));
  for (let i = 0; i + 1 < out.length; i++) out[i]!.to = out[i + 1]!.from;
  return out;
}

/**
 * Who has been knocked out by `t`, and in which segment.
 *
 * Read from OpenF1's own order at the moment the next segment starts, cut at
 * `qualifyingCut`. A driver who then sets off on a lap in a later segment was
 * plainly not knocked out, whatever the order said, so that wins: the cut is
 * a rule written down here, the lap is something that happened.
 */
export function knockedOut(buffers: Buffers, segs: readonly Segment[]): Map<number, number> {
  const out = new Map<number, number>();
  const cars = [...buffers.pos.values()].filter((p) => p.length > 0).length;
  for (let i = 0; i + 1 < segs.length; i++) {
    const seg = segs[i]!;
    const cut = qualifyingCut(cars, seg.phase);
    if (cut == null) continue;
    for (const [n, rows] of buffers.pos) {
      if (out.has(n)) continue;
      const k = lastAtOrBefore(rows, seg.to);
      const p = k >= 0 ? rows[k]![1] : null;
      if (p == null || p <= cut) continue;
      if (ranLater(buffers, n, seg.to)) continue;
      out.set(n, seg.phase);
    }
  }
  return out;
}

function ranLater(buffers: Buffers, n: number, from: number): boolean {
  const laps = buffers.laps.get(n);
  if (!laps) return false;
  for (const l of laps.values()) if (l.start != null && l.start >= from && !l.pitOut && l.dur) return true;
  return false;
}

/** The laps that count in segment `phase`. */
export function segmentScope(segs: readonly Segment[], phase: number, deleted: ReadonlySet<string>): LapScope {
  const seg = segs.find((s) => s.phase === phase);
  return seg ? { from: seg.from, to: seg.to, deleted } : { from: Infinity, to: Infinity, deleted };
}
