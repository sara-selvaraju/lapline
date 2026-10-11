// A stand-in for the circuit detail file that meetings link to.
//
// The mock imitated OpenF1 but not the second half of the data path, so a
// sector-scoped flag had nowhere to be drawn: without marshal sector positions
// there is no stretch of track to paint. This serves a file in the same shape
// MultiViewer's uses, derived from the mock's own track so the coordinates line
// up with its location rows.

import { N, P } from './circuit.js';

interface Marker {
  number: number;
  angle: number;
  length: number;
  trackPosition: { x: number; y: number };
}

/** Heading change per step, for finding where the synthetic track corners. */
function curvatures(): number[] {
  const out: number[] = [];
  for (let i = 0; i < N; i++) {
    const a = P[(i - 6 + N) % N]!;
    const b = P[i]!;
    const c = P[(i + 6) % N]!;
    const h1 = Math.atan2(b[1] - a[1], b[0] - a[0]);
    const h2 = Math.atan2(c[1] - b[1], c[0] - b[0]);
    let dh = Math.abs(h2 - h1);
    if (dh > Math.PI) dh = 2 * Math.PI - dh;
    out.push(dh / Math.max(Math.hypot(c[0] - a[0], c[1] - a[1]), 1));
  }
  return out;
}

/** Corners at the sharpest points, spread round the lap. */
function corners(): Marker[] {
  const k = curvatures();
  const gap = Math.floor(N / 14);
  const picked: number[] = [];
  const order = [...k.keys()].sort((a, b) => k[b]! - k[a]!);
  for (const i of order) {
    if (picked.length >= 12) break;
    if (picked.every((j) => Math.min(Math.abs(i - j), N - Math.abs(i - j)) >= gap)) picked.push(i);
  }
  picked.sort((a, b) => a - b);
  return picked.map((i, idx) => ({
    number: idx + 1,
    angle: 0,
    length: (i / N) * 5000,
    trackPosition: { x: P[i]![0], y: P[i]![1] },
  }));
}

/** Sixteen marshal sectors, evenly round the lap, as most circuits have. */
function marshalSectors(): Marker[] {
  return Array.from({ length: 16 }, (_, s) => {
    const i = Math.round((s / 16) * N);
    return {
      number: s + 1,
      angle: 0,
      length: (i / N) * 5000,
      trackPosition: { x: P[i]![0], y: P[i]![1] },
    };
  });
}

export function circuitFile(): Record<string, unknown> {
  return {
    circuitKey: 99,
    circuitName: 'Harbourfront',
    rotation: 0,
    corners: corners(),
    marshalSectors: marshalSectors(),
    marshalLights: marshalSectors(),
    x: P.map((p) => p[0]),
    y: P.map((p) => p[1]),
    trackPositionTime: P.map((_, i) => (i / N) * 82),
  };
}
