import { describe, expect, it } from 'vitest';
import type { HistorySample } from '../src/store/store.js';
import { BRAKE_Y, GRID, TRACE_MS, TRACE_W, traceShape, traceY } from '../src/ui/trace.js';

const T = 1_000_000;

/** Samples every 250 ms, as the 4 Hz tick produces. */
function ramp(
  count: number,
  speedAt: (i: number) => number,
  brakeAt: (i: number) => number = () => 0,
): HistorySample[] {
  return Array.from({ length: count }, (_, i) => [T + i * 250, speedAt(i), null, brakeAt(i)]);
}

describe('traceY', () => {
  it('puts the gridline speeds on their gridlines', () => {
    for (const g of GRID) expect(traceY(g.speed)).toBeCloseTo(g.y, 5);
  });

  it('puts a faster lap higher up the box', () => {
    expect(traceY(280)).toBeLessThan(traceY(120));
  });

  it('keeps a wild sample inside the box', () => {
    expect(traceY(9999)).toBeGreaterThanOrEqual(0);
    expect(traceY(-500)).toBeLessThanOrEqual(BRAKE_Y);
  });
});

describe('traceShape', () => {
  it('draws nothing at all until there are two samples', () => {
    expect(traceShape([]).path).toBeNull();
    expect(traceShape(ramp(1, () => 200)).path).toBeNull();
  });

  it('spans the full width once the window has filled', () => {
    const shape = traceShape(ramp(121, () => 200));
    const xs = shape.path!.slice(1).split('L').map((p) => Number(p.split(' ')[0]));
    expect(Math.min(...xs)).toBeCloseTo(0, 0);
    expect(Math.max(...xs)).toBeCloseTo(TRACE_W, 0);
  });

  it('ends at the newest sample, so a paused replay does not slide away', () => {
    // Two identical runs, one recorded much earlier. The drawing is the same.
    const now = traceShape(ramp(60, (i) => 100 + i));
    const old = traceShape(ramp(60, (i) => 100 + i).map(([t, s, th, b]) => [t - 600_000, s, th, b]));
    expect(old.path).toBe(now.path);
  });

  it('reports how much of the half-minute has filled', () => {
    expect(traceShape(ramp(41, () => 200)).filled).toBeCloseTo(10_000 / TRACE_MS, 2);
    expect(traceShape(ramp(121, () => 200)).filled).toBe(1);
  });

  it('drops samples that have fallen out of the window', () => {
    const long = ramp(400, () => 200);
    const shape = traceShape(long);
    const count = shape.path!.split('L').length;
    // 30 s at 4 Hz is about 120 points, not 400.
    expect(count).toBeLessThan(130);
    expect(count).toBeGreaterThan(110);
  });

  it('marks a braking run as one bar', () => {
    const shape = traceShape(ramp(40, () => 200, (i) => (i >= 10 && i < 20 ? 100 : 0)));
    expect(shape.braking).toHaveLength(1);
    const [x, w] = shape.braking[0]!;
    expect(x).toBeGreaterThan(0);
    expect(w).toBeGreaterThan(0);
  });

  it('marks separate braking zones separately', () => {
    const brake = (i: number): number => ((i >= 5 && i < 9) || (i >= 20 && i < 26) ? 100 : 0);
    expect(traceShape(ramp(40, () => 200, brake)).braking).toHaveLength(2);
  });

  it('closes a braking run still going at the newest sample', () => {
    const shape = traceShape(ramp(40, () => 200, (i) => (i >= 30 ? 100 : 0)));
    expect(shape.braking).toHaveLength(1);
    expect(shape.braking[0]![1]).toBeGreaterThan(0);
  });

  it('marks nothing when the car never brakes', () => {
    expect(traceShape(ramp(40, () => 200)).braking).toEqual([]);
  });

  it('skips samples with no speed rather than drawing them as zero', () => {
    const mixed: HistorySample[] = [
      [T, 200, null, 0],
      [T + 250, null, null, 0],
      [T + 500, 210, null, 0],
    ];
    const shape = traceShape(mixed);
    expect(shape.path!.split('L')).toHaveLength(2);
  });
});
