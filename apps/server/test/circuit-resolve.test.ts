// Placing circuit detail onto the outline.

import { describe, expect, it } from 'vitest';
import type { Point3 } from '@lapline/shared';
import { nearestIndex, resolveMarkers, sectorBoundaries, turnsFromOutline } from '../src/circuit/resolve.js';

/** A ring of 100 points, so an index maps cleanly onto an angle. */
const ring: Point3[] = Array.from({ length: 100 }, (_, i) => {
  const t = (i / 100) * Math.PI * 2;
  return [Math.cos(t) * 1000, Math.sin(t) * 1000, 0];
});

describe('nearestIndex', () => {
  it('finds the closest point', () => {
    expect(nearestIndex(ring, 1000, 0)).toBe(0);
    expect(nearestIndex(ring, 0, 1000)).toBe(25);
    expect(nearestIndex(ring, -1000, 0)).toBe(50);
  });

  it('ignores elevation, since detail is published without it', () => {
    const raised: Point3[] = ring.map(([x, y]) => [x, y, 9999]);
    expect(nearestIndex(raised, 0, 1000)).toBe(25);
  });

  it('copes with a point nowhere near the track', () => {
    expect(nearestIndex(ring, 500_000, 500_000)).toBeGreaterThanOrEqual(0);
  });
});

describe('resolveMarkers', () => {
  const marker = (number: number, x: number, y: number) => ({ number, trackPosition: { x, y } });

  it('places markers on the outline', () => {
    const out = resolveMarkers(ring, [marker(1, 1000, 0), marker(2, 0, 1000)]);
    expect(out).toEqual([
      { number: 1, index: 0 },
      { number: 2, index: 25 },
    ]);
  });

  it('orders them by position round the lap, whatever order they arrived in', () => {
    const out = resolveMarkers(ring, [marker(3, -1000, 0), marker(1, 1000, 0), marker(2, 0, 1000)]);
    expect(out.map((m) => m.index)).toEqual([0, 25, 50]);
  });

  it('keeps the published numbers rather than renumbering', () => {
    // Corner numbering is not always 1..n in lap order; 5a and 5b exist.
    const out = resolveMarkers(ring, [marker(14, 0, 1000)]);
    expect(out[0]!.number).toBe(14);
  });

  it('returns nothing without an outline', () => {
    expect(resolveMarkers([], [marker(1, 0, 0)])).toEqual([]);
  });
});

describe('sectorBoundaries', () => {
  it('splits the lap by each sector share of the time', () => {
    // A lap of 100s split 25/50/25 over 101 points.
    const out = sectorBoundaries(101, { s1: 25, s2: 50, s3: 25 });
    expect(out).toEqual([
      { label: 'S1', index: 0 },
      { label: 'S2', index: 25 },
      { label: 'S3', index: 75 },
    ]);
  });

  it('puts S1 at the line, because that is where the lap begins', () => {
    expect(sectorBoundaries(500, { s1: 27.193, s2: 38.471, s3: 26.048 })[0]).toEqual({ label: 'S1', index: 0 });
  });

  it('handles the real Singapore split', () => {
    const out = sectorBoundaries(354, { s1: 27.193, s2: 38.471, s3: 26.048 });
    // 27.193/91.712 = 29.65% and (27.193+38.471)/91.712 = 71.60% of the lap,
    // over 353 intervals.
    expect(out[1]!.index).toBe(105);
    expect(out[2]!.index).toBe(253);
  });

  it('returns nothing without sector times, which many sessions lack', () => {
    expect(sectorBoundaries(354, null)).toEqual([]);
  });

  it('returns nothing for a degenerate lap rather than dividing by zero', () => {
    expect(sectorBoundaries(354, { s1: 0, s2: 0, s3: 0 })).toEqual([]);
    expect(sectorBoundaries(2, { s1: 1, s2: 1, s3: 1 })).toEqual([]);
  });

  it('never indexes past the end of the outline', () => {
    const out = sectorBoundaries(10, { s1: 1, s2: 1, s3: 1000 });
    for (const b of out) expect(b.index).toBeLessThanOrEqual(9);
  });
});

describe('turnsFromOutline', () => {
  it('finds nothing on a shape that curves evenly', () => {
    expect(turnsFromOutline(ring)).toEqual([]);
  });

  it('returns indices into the outline, not coordinates', () => {
    const lumpy: Point3[] = Array.from({ length: 240 }, (_, i) => {
      const t = (i / 240) * Math.PI * 2;
      const r = 1000 * (1 + 0.35 * Math.sin(3 * t));
      return [Math.cos(t) * r, Math.sin(t) * r, 0];
    });
    const turns = turnsFromOutline(lumpy);
    expect(turns.length).toBeGreaterThan(0);
    for (const t of turns) {
      expect(Number.isInteger(t.index)).toBe(true);
      expect(t.index).toBeGreaterThanOrEqual(0);
      expect(t.index).toBeLessThan(lumpy.length);
    }
  });
});
