import { describe, expect, it } from 'vitest';
import type { Point3 } from '@lapline/shared';
import {
  offsetFromOutline,
  pickPitStops,
  pitLaneFromTrace,
  stopWindow,
  type PitStop,
} from '../src/circuit/pitlane.js';

/** A 1000 x 600 rectangle, sampled every 50 units. Span is 1000. */
function rectangle(): Point3[] {
  const pts: Point3[] = [];
  for (let x = 0; x < 1000; x += 50) pts.push([x, 0, 10]);
  for (let y = 0; y < 600; y += 50) pts.push([1000, y, 10]);
  for (let x = 1000; x > 0; x -= 50) pts.push([x, 600, 10]);
  for (let y = 600; y > 0; y -= 50) pts.push([0, y, 10]);
  return pts;
}

describe('offsetFromOutline', () => {
  const outline = rectangle();

  it('is zero on the outline, including between samples', () => {
    expect(offsetFromOutline(outline, [500, 0, 10])).toBeCloseTo(0);
    // Midway between two samples: a nearest-point measure would report 25.
    expect(offsetFromOutline(outline, [525, 0, 10])).toBeCloseTo(0);
  });

  it('measures the perpendicular offset', () => {
    expect(offsetFromOutline(outline, [500, 80, 10])).toBeCloseTo(80);
    expect(offsetFromOutline(outline, [525, -30, 10])).toBeCloseTo(30);
  });

  it('ignores elevation', () => {
    expect(offsetFromOutline(outline, [500, 0, 900])).toBeCloseTo(0);
  });

  it('wraps, because the outline is a closed lap', () => {
    // Near the start/finish line, reached by the closing segment.
    expect(offsetFromOutline(outline, [0, 25, 10])).toBeCloseTo(0);
  });
});

describe('pitLaneFromTrace', () => {
  const outline = rectangle();

  /** A trace along the bottom straight, with a lane 80 units inside it. */
  function traceWithLane(laneFrom = 100, laneTo = 800, offset = 80): Point3[] {
    const trace: Point3[] = [];
    for (let x = 0; x < laneFrom; x += 10) trace.push([x, 0, 10]);
    for (let x = laneFrom; x < laneTo; x += 10) trace.push([x, offset, 10]);
    for (let x = laneTo; x < 1000; x += 10) trace.push([x, 0, 10]);
    return trace;
  }

  it('finds the lane and leaves the racing line out', () => {
    const lane = pitLaneFromTrace(outline, traceWithLane());
    expect(lane.length).toBeGreaterThan(20);
    for (const p of lane) expect(p[1]).toBeCloseTo(80);
    expect(lane[0]![0]).toBeCloseTo(100);
    expect(lane[lane.length - 1]![0]).toBeCloseTo(790);
  });

  it('keeps the lane in the order it was driven', () => {
    const lane = pitLaneFromTrace(outline, traceWithLane());
    for (let i = 1; i < lane.length; i++) expect(lane[i]![0]).toBeGreaterThan(lane[i - 1]![0]);
  });

  it('collapses the seconds spent stationary in the box', () => {
    const trace = traceWithLane();
    const box = trace[40]!;
    // Twenty samples in the same place, as a 5 s stop at 4 Hz would give.
    trace.splice(41, 0, ...Array.from({ length: 20 }, () => [...box] as Point3));
    const lane = pitLaneFromTrace(outline, trace);
    const atBox = lane.filter((p) => p[0] === box[0] && p[1] === box[1]);
    expect(atBox).toHaveLength(1);
  });

  it('gives nothing for a lap that never leaves the racing line', () => {
    const trace: Point3[] = [];
    for (let x = 0; x < 1000; x += 10) trace.push([x, 0, 10]);
    expect(pitLaneFromTrace(outline, trace)).toEqual([]);
  });

  it('gives nothing for a car that merely runs wide', () => {
    // Off-line, but nothing like the length of a lane.
    expect(pitLaneFromTrace(outline, traceWithLane(400, 450))).toEqual([]);
  });

  it('gives nothing for a handful of stray samples', () => {
    const trace: Point3[] = [];
    for (let x = 0; x < 1000; x += 10) trace.push([x, x === 500 ? 80 : 0, 10]);
    expect(pitLaneFromTrace(outline, trace)).toEqual([]);
  });

  it('ignores an offset too small to be a lane', () => {
    // Inside the threshold: a wide line, not a different piece of tarmac.
    expect(pitLaneFromTrace(outline, traceWithLane(100, 800, 3))).toEqual([]);
  });

  it('takes the longest run when a trace has more than one', () => {
    const trace: Point3[] = [];
    for (let x = 0; x < 200; x += 10) trace.push([x, 0, 10]);
    for (let x = 200; x < 260; x += 10) trace.push([x, 80, 10]); // short detour
    for (let x = 260; x < 300; x += 10) trace.push([x, 0, 10]);
    for (let x = 300; x < 900; x += 10) trace.push([x, 80, 10]); // the lane
    for (let x = 900; x < 1000; x += 10) trace.push([x, 0, 10]);
    const lane = pitLaneFromTrace(outline, trace);
    expect(lane[0]![0]).toBeCloseTo(300);
    expect(lane[lane.length - 1]![0]).toBeCloseTo(890);
  });

  it('smooths elevation without moving the ends', () => {
    const trace = traceWithLane();
    const spiky = trace.map((p, i) => [p[0], p[1], i === 50 ? 500 : 10] as Point3);
    const lane = pitLaneFromTrace(outline, spiky);
    expect(Math.max(...lane.map((p) => p[2]))).toBeLessThan(500);
  });

  it('survives an empty or degenerate outline', () => {
    expect(pitLaneFromTrace([], traceWithLane())).toEqual([]);
    expect(pitLaneFromTrace(outline, [])).toEqual([]);
  });
});

describe('pickPitStops', () => {
  const stop = (driver: number, at: number, laneDurationS: number): PitStop => ({
    driver,
    at,
    laneDurationS,
  });

  it('drops stops too short or too long to be a normal stop', () => {
    const picked = pickPitStops([stop(1, 100, 3), stop(2, 200, 24), stop(3, 300, 400)]);
    expect(picked.map((s) => s.driver)).toEqual([2]);
  });

  it('prefers later stops, when the field has settled', () => {
    const picked = pickPitStops([stop(1, 100, 24), stop(2, 900, 22), stop(3, 500, 26)]);
    expect(picked.map((s) => s.driver)).toEqual([2, 3, 1]);
  });

  it('gives nothing when there are no stops', () => {
    expect(pickPitStops([])).toEqual([]);
  });
});

describe('stopWindow', () => {
  it('covers the lane plus a margin either side', () => {
    const { from, to } = stopWindow({ driver: 44, at: 1_000_000, laneDurationS: 24 }, 20_000);
    expect(from).toBe(1_000_000 - 24_000 - 20_000);
    expect(to).toBe(1_020_000);
  });
});
