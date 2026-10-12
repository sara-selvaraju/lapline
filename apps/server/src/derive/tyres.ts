// Compound and age, from the stint covering a lap.

import type { Buffers } from '../feed/buffers.js';

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
