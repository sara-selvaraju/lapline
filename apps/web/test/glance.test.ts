import { describe, expect, it } from 'vitest';
import type { Circuit, TowerRow } from '@lapline/shared';
import { flatPath, glanceGap, topFive } from '../src/ui/Glance.js';

const row = (over: Partial<TowerRow>): TowerRow => ({
  n: 1,
  p: 1,
  gap: null,
  int: null,
  lap: 5,
  last: null,
  best: null,
  tyre: null,
  age: null,
  pit: false,
  lapFlag: null,
  stops: 0,
  outIn: null,
  ...over,
});

describe('topFive', () => {
  it('takes the leaders, in order', () => {
    const rows = [row({ n: 3, p: 3 }), row({ n: 1, p: 1 }), row({ n: 2, p: 2 })];
    expect(topFive(rows).map((r) => r.p)).toEqual([1, 2, 3]);
  });

  it('stops at five, however many are racing', () => {
    const rows = Array.from({ length: 20 }, (_, i) => row({ n: i + 1, p: i + 1 }));
    expect(topFive(rows)).toHaveLength(5);
  });

  it('leaves out a car with no position yet', () => {
    const rows = [row({ n: 1, p: 1 }), row({ n: 9, p: null })];
    expect(topFive(rows).map((r) => r.n)).toEqual([1]);
  });

  it('copes with no timing at all', () => {
    expect(topFive([])).toEqual([]);
  });
});

describe('glanceGap', () => {
  it('says Leader rather than a gap of nothing', () => {
    expect(glanceGap(row({ p: 1, int: null }))).toBe('Leader');
  });

  it('rounds to a tenth, which is all anyone reads across a room', () => {
    expect(glanceGap(row({ p: 2, int: 1.204 }))).toBe('+1.2');
    expect(glanceGap(row({ p: 3, int: 0.684 }))).toBe('+0.7');
  });

  it('passes upstream text through', () => {
    expect(glanceGap(row({ p: 12, int: '+1 LAP' }))).toBe('+1 LAP');
  });

  it('shows a dash when there is no interval', () => {
    expect(glanceGap(row({ p: 4, int: null }))).toBe('–');
  });
});

describe('flatPath', () => {
  const circuit = (points: Array<[number, number, number]>): Circuit => ({
    points,
    transform: { cx: 0, cy: 0, cz: 0, scale: 1 },
    source: 'test',
    turns: [],
    sectors: [],
    marshalSectors: [],
    pitLane: [],
    detailSource: 'none',
  });

  /** A square, which is enough points to draw. */
  const square = (): Array<[number, number, number]> =>
    Array.from({ length: 12 }, (_, i) => {
      const t = (i / 12) * Math.PI * 2;
      return [Math.round(5000 * Math.cos(t)), Math.round(5000 * Math.sin(t)), 0] as [number, number, number];
    });

  it('closes the loop, because a lap is one', () => {
    expect(flatPath(circuit(square()))!.d.endsWith('Z')).toBe(true);
  });

  it('fits inside the box it is drawn in', () => {
    const { d } = flatPath(circuit(square()))!;
    const numbers = d.match(/-?\d+(\.\d+)?/g)!.map(Number);
    expect(Math.min(...numbers)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...numbers)).toBeLessThanOrEqual(100);
  });

  it('flips the vertical, since OpenF1 counts the other way from an SVG', () => {
    const { at } = flatPath(circuit(square()))!;
    const [, low] = at([0, -5000]);
    const [, high] = at([0, 5000]);
    expect(low).toBeGreaterThan(high);
  });

  it('places a car with the same mapping as the outline', () => {
    const { at } = flatPath(circuit(square()))!;
    const [x, y] = at([0, 0]);
    expect(x).toBeCloseTo(50, 0);
    expect(y).toBeCloseTo(50, 0);
  });

  it('draws nothing without a circuit worth drawing', () => {
    expect(flatPath(null)).toBeNull();
    expect(flatPath(circuit([[0, 0, 0]]))).toBeNull();
  });
});
