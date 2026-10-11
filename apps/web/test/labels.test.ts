// The label rule and the collision resolver, independent of three.js.

import { describe, expect, it } from 'vitest';
import type { TowerRow } from '@lapline/shared';
import { labelledDrivers, resolveCollisions, type LabelBox } from '../src/scene/labels.js';

const row = (n: number, p: number | null, gap: number | string | null): TowerRow => ({
  n,
  p,
  gap,
  int: null,
  lap: 5,
  last: null,
  best: null,
  tyre: null,
  age: null,
  pit: false,
});

// Leader, then a pack, then one a long way back.
const rows: TowerRow[] = [
  row(1, 1, null),
  row(2, 2, 0.4),
  row(3, 3, 0.9),
  row(4, 4, 1.6),
  row(5, 5, 30.0),
  row(6, 20, '+1 LAP'),
];

describe('labelledDrivers', () => {
  it('always labels the leader', () => {
    expect(labelledDrivers(rows, null, false).has(1)).toBe(true);
  });

  it('labels the selected car', () => {
    expect(labelledDrivers(rows, 5, false).has(5)).toBe(true);
  });

  it('labels cars within a second of the selected car', () => {
    // Selected is 4 at +1.6; 3 is at +0.9 (0.7 away) and 5 at +30 is not.
    const out = labelledDrivers(rows, 4, false);
    expect([...out].sort((a, b) => a - b)).toEqual([1, 3, 4]);
  });

  it('counts the window from the selected car, not from the leader', () => {
    const out = labelledDrivers(rows, 2, false);
    // 2 is at +0.4: 1 (leader, 0) and 3 (+0.9) are both inside a second.
    expect([...out].sort((a, b) => a - b)).toEqual([1, 2, 3]);
  });

  it('leaves out a lapped car, whose gap is text rather than a number', () => {
    expect(labelledDrivers(rows, 4, false).has(6)).toBe(false);
  });

  it('labels everything when the setting says so', () => {
    expect(labelledDrivers(rows, 4, true).size).toBe(rows.length);
  });

  it('labels only the leader when nothing is selected', () => {
    expect([...labelledDrivers(rows, null, false)]).toEqual([1]);
  });

  it('copes with no rows at all', () => {
    expect(labelledDrivers([], 4, false).has(4)).toBe(true);
    expect(labelledDrivers([], null, false).size).toBe(0);
  });
});

describe('resolveCollisions', () => {
  const box = (n: number, x: number, y: number, priority = 2): LabelBox => ({
    n,
    x,
    y,
    width: 40,
    height: 16,
    priority,
  });

  it('leaves labels that do not overlap where they are', () => {
    const out = resolveCollisions([box(1, 100, 100), box(2, 100, 200)]);
    expect(out.get(1)).toBe(0);
    expect(out.get(2)).toBe(0);
  });

  it('leaves labels side by side alone, since they do not overlap', () => {
    const out = resolveCollisions([box(1, 100, 100), box(2, 200, 100)]);
    expect(out.get(2)).toBe(0);
  });

  it('pushes an overlapping label clear', () => {
    const out = resolveCollisions([box(1, 100, 100), box(2, 100, 108)]);
    expect(out.get(1)).toBe(0);
    expect(out.get(2)).toBeLessThan(0);
    // Clear of the first box, which spans 92 to 108.
    expect(108 + out.get(2)! - 8).toBeLessThanOrEqual(92);
  });

  it('keeps the highest-priority label in place and moves the others', () => {
    // The selected car is priority 0 even though it sorts later by y.
    const out = resolveCollisions([box(1, 100, 100, 2), box(2, 100, 104, 0)]);
    expect(out.get(2)).toBe(0);
    expect(out.get(1)).toBeLessThan(0);
  });

  it('separates a whole stack, as a bunch of cars produces', () => {
    const stack = [box(1, 100, 100), box(2, 100, 102), box(3, 100, 104), box(4, 100, 106)];
    const out = resolveCollisions(stack);
    const spans = stack
      .map((b) => ({ top: b.y - b.height / 2 + out.get(b.n)!, bottom: b.y + b.height / 2 + out.get(b.n)! }))
      .sort((a, b) => a.top - b.top);
    for (let i = 1; i < spans.length; i++) {
      expect(spans[i]!.top).toBeGreaterThanOrEqual(spans[i - 1]!.bottom - 0.001);
    }
  });

  it('terminates even when asked to place more labels than can possibly fit', () => {
    const many = Array.from({ length: 40 }, (_, i) => box(i, 100, 100));
    expect(() => resolveCollisions(many)).not.toThrow();
    expect(resolveCollisions(many).size).toBe(40);
  });
});
