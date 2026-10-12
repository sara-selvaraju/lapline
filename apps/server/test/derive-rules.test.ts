// The two rules M4 adds, tested on their own.
//
// docs/BUILD-PLAN.md M4: "Unit tests for the battle and lap-colour rules."

import { describe, expect, it } from 'vitest';
import { createBuffers, type Buffers } from '../src/feed/buffers.js';
import { battles, BATTLE_S } from '../src/derive/battles.js';
import { lapColour, sessionBest } from '../src/derive/laps.js';
import type { RaceControlRow } from '@lapline/shared';

const T = 1_000_000;

/** Laps for one driver: [lap number, duration, pit-out?], run back to back. */
function withLaps(
  spec: Record<number, Array<[n: number, dur: number, pitOut?: boolean]>>,
  from = T,
): Buffers {
  const b = createBuffers();
  for (const [driver, laps] of Object.entries(spec)) {
    const m = new Map();
    let start = from;
    for (const [n, dur, pitOut] of laps) {
      m.set(n, { n, start, dur, pitOut: Boolean(pitOut), sectors: null });
      start += dur * 1000;
    }
    b.laps.set(Number(driver), m);
  }
  return b;
}

/** Intervals: the gap each driver has to the car ahead at T. */
function withIntervals(spec: Record<number, number | string | null>): Buffers {
  const b = createBuffers();
  for (const [driver, interval] of Object.entries(spec)) {
    b.ivl.set(Number(driver), [[T, null, interval]]);
  }
  return b;
}

function raceControl(b: Buffers, rows: Array<Partial<RaceControlRow>>): Buffers {
  b.rc = rows.map((r) => [T - 1000, r as RaceControlRow]);
  return b;
}

describe('battles', () => {
  it('marks a car within a second of the one ahead', () => {
    expect(battles(withIntervals({ 1: 0.4, 44: 2.8 }), T)).toEqual([1]);
  });

  it('measures the interval, not the gap to the leader', () => {
    // P3 is 8 s behind the leader but half a second off P2. That is a battle,
    // and it is the case the tower used to get wrong when the viewer switched
    // the column to "To leader".
    const b = createBuffers();
    b.ivl.set(16, [[T, 8.2, 0.5]]);
    expect(battles(b, T)).toEqual([16]);
  });

  it('excludes the leader, who has no car ahead', () => {
    expect(battles(withIntervals({ 1: null, 44: 0.6 }), T)).toEqual([44]);
  });

  it('excludes a lapped car, whose interval is text', () => {
    expect(battles(withIntervals({ 1: '+1 LAP', 44: 0.6 }), T)).toEqual([44]);
  });

  it('is exclusive at exactly one second', () => {
    expect(battles(withIntervals({ 1: BATTLE_S }), T)).toEqual([]);
    expect(battles(withIntervals({ 1: BATTLE_S - 0.001 }), T)).toEqual([1]);
  });

  it('finds nobody under a yellow', () => {
    const b = raceControl(withIntervals({ 1: 0.4, 44: 0.5 }), [
      { category: 'Flag', scope: 'Track', flag: 'YELLOW' },
    ]);
    expect(battles(b, T)).toEqual([]);
  });

  it('finds nobody behind a safety car, however close the train runs', () => {
    const b = raceControl(withIntervals({ 1: 0.3, 44: 0.3, 16: 0.3 }), [
      { category: 'SafetyCar', message: 'SAFETY CAR DEPLOYED' },
    ]);
    expect(battles(b, T)).toEqual([]);
  });

  it('comes back when the track goes green again', () => {
    const b = withIntervals({ 1: 0.4 });
    b.rc = [
      [T - 2000, { category: 'SafetyCar', message: 'SAFETY CAR DEPLOYED' } as RaceControlRow],
      [T - 1000, { category: 'Flag', scope: 'Track', flag: 'GREEN' } as RaceControlRow],
    ];
    expect(battles(b, T)).toEqual([1]);
  });

  it('returns driver numbers in order, so the wire is stable frame to frame', () => {
    expect(battles(withIntervals({ 44: 0.5, 1: 0.5, 16: 0.5 }), T)).toEqual([1, 16, 44]);
  });
});

describe('sessionBest', () => {
  it('is the quickest lap anyone has finished', () => {
    const b = withLaps({ 1: [[1, 95], [2, 92]], 44: [[1, 94], [2, 93]] });
    expect(sessionBest(b, T + 1_000_000)).toBe(92);
  });

  it('ignores laps not yet finished at the clock', () => {
    const b = withLaps({ 1: [[1, 95], [2, 92]] });
    expect(sessionBest(b, T + 95_500)).toBe(95);
  });

  it('ignores pit-out laps', () => {
    const b = withLaps({ 1: [[1, 95], [2, 80, true]] });
    expect(sessionBest(b, T + 1_000_000)).toBe(95);
  });
});

describe('lapColour', () => {
  const after = T + 1_000_000;

  it('is purple for the driver holding the session best', () => {
    const b = withLaps({ 1: [[1, 95], [2, 92]], 44: [[1, 94], [2, 93]] });
    expect(lapColour(b, 1, after)).toBe('fastest');
  });

  it('is purple on exactly one row', () => {
    const b = withLaps({ 1: [[1, 95], [2, 92]], 44: [[1, 94], [2, 93]], 16: [[1, 96], [2, 94]] });
    const purple = [1, 44, 16].filter((n) => lapColour(b, n, after) === 'fastest');
    expect(purple).toEqual([1]);
  });

  it('clears once that driver completes a slower lap', () => {
    // The whole point of "on the lap just completed": their best is still the
    // session's fastest, but it is no longer the lap they have just done.
    const b = withLaps({ 1: [[1, 95], [2, 92], [3, 94]], 44: [[1, 97]] });
    expect(lapColour(b, 1, after)).toBeNull();
    expect(sessionBest(b, after)).toBe(92);
  });

  it('is green for a personal best that is not the session best', () => {
    const b = withLaps({ 1: [[1, 95], [2, 93]], 44: [[1, 90]] });
    expect(lapColour(b, 1, after)).toBe('pb');
  });

  it('is nothing for a lap slower than one of their own', () => {
    const b = withLaps({ 1: [[1, 93], [2, 95]], 44: [[1, 90]] });
    expect(lapColour(b, 1, after)).toBeNull();
  });

  it('is nothing for merely equalling your own earlier best', () => {
    const b = withLaps({ 1: [[1, 93], [2, 93]], 44: [[1, 90]] });
    expect(lapColour(b, 1, after)).toBeNull();
  });

  it('is nothing for a pit-out lap, however quick it reads', () => {
    const b = withLaps({ 1: [[1, 95], [2, 60, true]], 44: [[1, 94]] });
    expect(lapColour(b, 1, after)).toBeNull();
  });

  it('is purple on the first lap anyone completes', () => {
    const b = withLaps({ 1: [[1, 95]] });
    expect(lapColour(b, 1, after)).toBe('fastest');
  });

  it('keeps the session best set by a driver who has since retired', () => {
    // The retired car stops appearing in the tower, but its lap still stands,
    // so nobody else is promoted to purple for a slower time.
    const b = withLaps({ 7: [[1, 88]], 1: [[1, 95], [2, 93]] });
    expect(sessionBest(b, after)).toBe(88);
    expect(lapColour(b, 1, after)).toBe('pb');
  });

  it('judges by the clock, not by the whole lap list', () => {
    const b = withLaps({ 1: [[1, 95], [2, 92]] });
    // Only lap 1 is finished yet, so that is the lap just completed.
    expect(lapColour(b, 1, T + 95_500)).toBe('fastest');
  });

  it('is nothing for a driver with no laps', () => {
    expect(lapColour(createBuffers(), 99, after)).toBeNull();
  });
});
