// How many cars go through from each qualifying segment.
//
// Shared because both apps need it: the server to tell who has been knocked
// out, the client to draw the line under the last car going through.

/**
 * The last position that goes through from segment `phase`, or null when
 * nothing does (Q3, or anything else).
 *
 * Ten cars always contest Q3, and Q1 and Q2 knock out the rest in equal
 * halves: 22 cars go 22, 16, 10, and 20 went 20, 15, 10. That is the rule as
 * it stands in 2026; OpenF1 publishes no cut-off of its own to read instead.
 */
export function qualifyingCut(cars: number, phase: number): number | null {
  if (cars <= 10) return null;
  const out = Math.floor((cars - 10) / 2);
  if (phase === 1) return cars - out;
  if (phase === 2) return 10;
  return null;
}
