// The sync rule, tested on its own.
//
// docs/BUILD-PLAN.md M6: "In live mock, marking a crossing sets the delay to
// within ±1 s of the injected broadcast delay." That check drives the feed;
// these cover the arithmetic underneath it.

import { describe, expect, it } from 'vitest';
import { createBuffers, type Buffers } from '../src/feed/buffers.js';
import {
  crossings,
  delayFromTap,
  lapMetres,
  leaderAt,
  nextCrossing,
  MAX_DELAY_S,
  MIN_DELAY_S,
} from '../src/derive/crossings.js';

const T = 1_000_000;

/** A leader with laps every 90 s from T. */
function withLeader(driver = 1, count = 10, dur = 90): Buffers {
  const b = createBuffers();
  b.pos.set(driver, [[T, 1]]);
  const m = new Map();
  for (let n = 1; n <= count; n++) {
    m.set(n, { n, start: T + (n - 1) * dur * 1000, dur, pitOut: false, sectors: null });
  }
  b.laps.set(driver, m);
  return b;
}

describe('leaderAt', () => {
  it('finds whoever holds first place', () => {
    const b = createBuffers();
    b.pos.set(44, [[T, 3]]);
    b.pos.set(1, [[T, 1]]);
    expect(leaderAt(b, T + 1000)).toBe(1);
  });

  it('is null before anyone has a position', () => {
    expect(leaderAt(createBuffers(), T)).toBeNull();
  });
});

describe('crossings', () => {
  it('lists the leader’s lap starts, oldest first', () => {
    const got = crossings(withLeader(), T + 1_000_000);
    expect(got[0]).toBe(T);
    expect(got[1]).toBe(T + 90_000);
    expect(got).toEqual([...got].sort((a, b) => a - b));
  });

  it('stops at the clock, so a replay cannot see the future', () => {
    expect(crossings(withLeader(), T + 200_000)).toEqual([T, T + 90_000, T + 180_000]);
  });

  it('honours since', () => {
    const got = crossings(withLeader(), T + 1_000_000, T + 200_000);
    expect(Math.min(...got)).toBeGreaterThanOrEqual(T + 200_000);
  });

  it('is empty when nobody is leading', () => {
    expect(crossings(createBuffers(), T)).toEqual([]);
  });
});

describe('delayFromTap', () => {
  const times = [T, T + 90_000, T + 180_000];

  it('is the gap back to the last crossing', () => {
    expect(delayFromTap(times, T + 90_000 + 12_000)).toBe(12);
  });

  it('takes the most recent crossing, not the first', () => {
    expect(delayFromTap(times, T + 180_000 + 8_000)).toBe(8);
  });

  it('keeps a tenth of a second, which is finer than anyone can tap', () => {
    expect(delayFromTap(times, T + 90_000 + 12_400)).toBe(12.4);
  });

  it('will not go under the floor, because OpenF1 itself is 3 s behind', () => {
    expect(delayFromTap(times, T + 90_000 + 500)).toBe(MIN_DELAY_S);
  });

  it('will not park the session minutes in the past', () => {
    expect(delayFromTap(times, T + 180_000 + 600_000)).toBe(MAX_DELAY_S);
  });

  it('has no answer for a tap before any crossing', () => {
    expect(delayFromTap(times, T - 1000)).toBeNull();
    expect(delayFromTap([], T)).toBeNull();
  });
});

describe('nextCrossing', () => {
  it('names the leader and when they are next due', () => {
    // 30 s into lap 3 of a 90 s lap: 60 s to go.
    const got = nextCrossing(withLeader(), T + 180_000 + 30_000, 5000);
    expect(got?.n).toBe(1);
    expect(got?.at).toBe(T + 180_000 + 90_000);
  });

  it('estimates how far they still are from the line', () => {
    // A third of the way round a 5 km lap leaves about two thirds.
    const got = nextCrossing(withLeader(), T + 180_000 + 30_000, 5000);
    expect(got?.metres).toBeGreaterThan(3200);
    expect(got?.metres).toBeLessThan(3400);
  });

  it('says nothing rather than guessing before a lap has been completed', () => {
    const b = createBuffers();
    b.pos.set(1, [[T, 1]]);
    b.laps.set(1, new Map([[1, { n: 1, start: T, dur: null, pitOut: false, sectors: null }]]));
    expect(nextCrossing(b, T + 10_000, 5000)).toEqual({ n: 1, at: null, metres: null });
  });

  it('is null when nobody is leading', () => {
    expect(nextCrossing(createBuffers(), T, 5000)).toBeNull();
  });
});

describe('lapMetres', () => {
  it('converts the outline to metres, which OpenF1 publishes in decimetres', () => {
    // A 1000 x 1000 square is 4000 units round, so 400 m.
    const square: Array<[number, number, number]> = [
      [0, 0, 0],
      [1000, 0, 0],
      [1000, 1000, 0],
      [0, 1000, 0],
    ];
    expect(lapMetres(square)).toBe(400);
  });

  it('closes the loop, since the outline is a lap', () => {
    const open: Array<[number, number, number]> = [
      [0, 0, 0],
      [1000, 0, 0],
      [2000, 0, 0],
    ];
    // Out 2000 units and back again.
    expect(lapMetres(open)).toBe(400);
  });

  it('has nothing to say about an outline that is not one', () => {
    expect(lapMetres([])).toBeNull();
  });
});
