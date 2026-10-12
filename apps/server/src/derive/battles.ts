// Who is fighting whom.
//
// docs/ARCHITECTURE.md: "consecutive cars within 1.0 s, only under green".
// Both halves matter. It is the interval — the gap to the car ahead — not the
// gap to the leader, which is a different number that happens to share a
// column in the tower. And it is only under green, because a train of cars
// nose to tail behind a safety car is not a battle.
//
// Decided here rather than in the tower so the rule is one tested function
// rather than a property of whichever column the viewer has chosen to show.

import { lastAtOrBefore, type Buffers } from '../feed/buffers.js';
import { trackFlag } from './flags.js';

/** Closer than this to the car ahead counts as a battle. */
export const BATTLE_S = 1.0;

/** Driver numbers within `BATTLE_S` of the car ahead, under green only. */
export function battles(buffers: Buffers, t: number): number[] {
  if (trackFlag(buffers, t) !== 'GREEN') return [];

  const out: number[] = [];
  for (const [n, rows] of buffers.ivl) {
    const i = lastAtOrBefore(rows, t);
    if (i < 0) continue;
    const interval = rows[i]![2];
    // Upstream sends text such as '+1 LAP' for a lapped car, and null for the
    // leader. Neither is a gap, so neither is a battle.
    if (typeof interval !== 'number') continue;
    if (interval > 0 && interval < BATTLE_S) out.push(n);
  }
  return out.sort((a, b) => a - b);
}
