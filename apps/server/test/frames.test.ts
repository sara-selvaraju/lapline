import { describe, expect, it } from 'vitest';
import { createBuffers, type Buffers } from '../src/feed/buffers.js';
import { buildCars, buildTick, buildTiming, currentLap, trackFlag, tyre } from '../src/feed/frames.js';

const T = 1_000_000;

function withLoc(samples: Array<[number, number, number, number]>): Buffers {
  const b = createBuffers();
  b.loc.set(4, samples);
  return b;
}

describe('position interpolation', () => {
  it('interpolates linearly between two samples', () => {
    const b = withLoc([
      [T, 0, 0, 0],
      [T + 1000, 100, 200, 40],
    ]);
    const [car] = buildCars(b, T + 500);
    expect([car![1], car![2], car![3]]).toEqual([50, 100, 20]);
  });

  it('holds the last sample when there is no later one', () => {
    const b = withLoc([[T, 10, 20, 30]]);
    const [car] = buildCars(b, T + 100);
    expect([car![1], car![2], car![3]]).toEqual([10, 20, 30]);
  });

  it('does not interpolate across a gap of 2.5 s or more', () => {
    const b = withLoc([
      [T, 0, 0, 0],
      [T + 2500, 1000, 1000, 1000],
    ]);
    const [car] = buildCars(b, T + 1000);
    expect([car![1], car![2], car![3]]).toEqual([0, 0, 0]);
  });

  it('interpolates across a gap just under the limit', () => {
    const b = withLoc([
      [T, 0, 0, 0],
      [T + 2499, 2499, 0, 0],
    ]);
    const [car] = buildCars(b, T + 1000);
    expect(car![1]).toBe(1000);
  });

  it('rounds x, y and z', () => {
    const b = withLoc([
      [T, 0, 0, 0],
      [T + 1000, 3, 3, 3],
    ]);
    const [car] = buildCars(b, T + 500);
    expect([car![1], car![2], car![3]]).toEqual([2, 2, 2]);
  });

  it('never interpolates between two samples sharing a timestamp', () => {
    // The duplicate-row case: the search lands on the later copy, so the bracket
    // has a non-zero span and no coordinate becomes NaN.
    const b = withLoc([
      [T, 0, 0, 0],
      [T, 10, 10, 10],
      [T + 1000, 20, 20, 20],
    ]);
    const [car] = buildCars(b, T + 500);
    expect(car![1]).toBe(15);
    expect(Number.isNaN(car![1])).toBe(false);
  });
});

describe('staleness', () => {
  it('marks a car stale when its newest sample is over 8 s old', () => {
    const b = withLoc([[T, 1, 1, 1]]);
    expect(buildCars(b, T + 8001)[0]![10]).toBe(1);
  });

  it('leaves a car fresh at exactly 8 s', () => {
    const b = withLoc([[T, 1, 1, 1]]);
    expect(buildCars(b, T + 8000)[0]![10]).toBe(0);
  });
});

describe('the car tuple', () => {
  it('emits number, x, y, z, speed, gear, rpm, throttle, brake, drs, stale', () => {
    // Pins the order the web destructures positionally. The car buffer holds
    // speed, rpm, gear; this swaps rpm and gear on the way out.
    const b = withLoc([[T, 11, 22, 33]]);
    b.car.set(4, [[T, 310, 11200, 7, 100, 0, 0]]);
    expect(buildCars(b, T)[0]).toEqual([4, 11, 22, 33, 310, 7, 11200, 100, 0, 0, 0]);
  });

  it('sends nulls for telemetry when there is no car-data sample', () => {
    const b = withLoc([[T, 1, 2, 3]]);
    expect(buildCars(b, T)[0]!.slice(4, 10)).toEqual([null, null, null, null, null, null]);
  });

  it('turns a missing upstream field into null rather than undefined', () => {
    const b = withLoc([[T, 1, 2, 3]]);
    b.car.set(4, [[T, 100, undefined, undefined, undefined, undefined, undefined]]);
    const car = buildCars(b, T)[0]!;
    expect(car[6]).toBeNull();
    expect(JSON.parse(JSON.stringify(car))[6]).toBeNull();
  });

  it('omits a car with no location samples at or before the clock', () => {
    const b = withLoc([[T + 10_000, 1, 1, 1]]);
    expect(buildCars(b, T)).toHaveLength(0);
  });
});

describe('currentLap', () => {
  const b = createBuffers();
  b.laps.set(4, new Map([
    [1, { n: 1, start: T, dur: 95, pitOut: false }],
    [2, { n: 2, start: T + 95_000, dur: 90, pitOut: false }],
    [3, { n: 3, start: T + 185_000, dur: 88, pitOut: true }],
    [4, { n: 4, start: T + 273_000, dur: null, pitOut: false }],
  ]));

  it('reports the lap in progress', () => {
    expect(currentLap(b, 4, T + 280_000).lap).toBe(4);
  });

  it('reports the most recently completed lap time', () => {
    expect(currentLap(b, 4, T + 280_000).last).toBe(88);
  });

  it('excludes a pit-out lap from the best', () => {
    expect(currentLap(b, 4, T + 280_000).best).toBe(90);
  });

  it('counts only laps completed by the clock', () => {
    expect(currentLap(b, 4, T + 100_000).last).toBe(95);
    expect(currentLap(b, 4, T + 100_000).best).toBe(95);
  });

  it('returns nulls for a driver with no laps', () => {
    expect(currentLap(b, 99, T)).toEqual({ lap: null, last: null, best: null });
  });
});

describe('tyre', () => {
  const b = createBuffers();
  b.stints.set(4, new Map([
    [1, { compound: 'MEDIUM', start: 1, end: 8, age0: 0 }],
    [2, { compound: 'HARD', start: 9, end: null, age0: 3 }],
  ]));

  it('finds the stint covering the lap and adds its age', () => {
    expect(tyre(b, 4, 5)).toEqual({ tyre: 'MEDIUM', age: 4 });
    expect(tyre(b, 4, 12)).toEqual({ tyre: 'HARD', age: 6 });
  });

  it('returns nulls with no lap or no stints', () => {
    expect(tyre(b, 4, null)).toEqual({ tyre: null, age: null });
    expect(tyre(b, 99, 5)).toEqual({ tyre: null, age: null });
  });

  it('falls back to the latest stint started when none brackets the lap', () => {
    const c = createBuffers();
    c.stints.set(4, new Map([[1, { compound: 'SOFT', start: 1, end: 3, age0: 0 }]]));
    expect(tyre(c, 4, 20)).toEqual({ tyre: 'SOFT', age: 19 });
  });
});

describe('trackFlag', () => {
  const rc = (t: number, row: Record<string, unknown>): [number, Record<string, unknown>] => [t, row];
  const withRc = (rows: Array<[number, Record<string, unknown>]>): Buffers => {
    const b = createBuffers();
    b.rc = rows as Buffers['rc'];
    return b;
  };

  it('is green before anything happens', () => {
    expect(trackFlag(createBuffers(), T)).toBe('GREEN');
  });

  it('walks the mock script: green, safety car, ending, green, chequered', () => {
    const b = withRc([
      rc(T, { category: 'Flag', flag: 'GREEN', scope: 'Track', message: 'GREEN LIGHT' }),
      rc(T + 300_000, { category: 'Flag', flag: 'YELLOW', scope: 'Sector', message: 'YELLOW IN TRACK SECTOR 7' }),
      rc(T + 540_000, { category: 'SafetyCar', flag: null, scope: 'Track', message: 'SAFETY CAR DEPLOYED' }),
      rc(T + 660_000, { category: 'SafetyCar', flag: null, scope: 'Track', message: 'SAFETY CAR IN THIS LAP' }),
      rc(T + 720_000, { category: 'Flag', flag: 'GREEN', scope: 'Track', message: 'TRACK CLEAR' }),
      rc(T + 900_000, { category: 'Flag', flag: 'CHEQUERED', scope: 'Track', message: 'CHEQUERED FLAG' }),
    ]);
    expect(trackFlag(b, T + 100_000)).toBe('GREEN');
    expect(trackFlag(b, T + 400_000)).toBe('GREEN');
    expect(trackFlag(b, T + 600_000)).toBe('SC');
    expect(trackFlag(b, T + 700_000)).toBe('SC ENDING');
    expect(trackFlag(b, T + 800_000)).toBe('GREEN');
    expect(trackFlag(b, T + 999_999)).toBe('CHEQUERED');
  });

  it('ignores sector-scoped flags, which colour a marshal sector not the track', () => {
    const b = withRc([
      rc(T, { category: 'Flag', flag: 'YELLOW', scope: 'Sector', message: 'YELLOW IN TRACK SECTOR 7' }),
    ]);
    expect(trackFlag(b, T + 1)).toBe('GREEN');
  });

  it('takes a track-scoped yellow and a red', () => {
    expect(trackFlag(withRc([rc(T, { category: 'Flag', flag: 'YELLOW', scope: 'Track' })]), T + 1)).toBe('YELLOW');
    expect(trackFlag(withRc([rc(T, { category: 'Flag', flag: 'RED', scope: 'Track' })]), T + 1)).toBe('RED');
  });

  it('treats a flag with no scope as track-wide', () => {
    expect(trackFlag(withRc([rc(T, { category: 'Flag', flag: 'RED' })]), T + 1)).toBe('RED');
  });

  it('recognises a virtual safety car', () => {
    const b = withRc([rc(T, { category: 'SafetyCar', message: 'VIRTUAL SAFETY CAR DEPLOYED' })]);
    expect(trackFlag(b, T + 1)).toBe('VSC');
  });

  it('ends a virtual safety car as VSC ENDING', () => {
    const b = withRc([
      rc(T, { category: 'SafetyCar', message: 'VIRTUAL SAFETY CAR DEPLOYED' }),
      rc(T + 1000, { category: 'SafetyCar', message: 'VIRTUAL SAFETY CAR ENDING' }),
    ]);
    expect(trackFlag(b, T + 2000)).toBe('VSC ENDING');
  });

  it('ignores messages after the clock', () => {
    const b = withRc([rc(T + 10_000, { category: 'Flag', flag: 'RED', scope: 'Track' })]);
    expect(trackFlag(b, T)).toBe('GREEN');
  });
});

describe('buildTiming', () => {
  function populated(): Buffers {
    const b = createBuffers();
    b.drivers.set(4, { n: 4, code: 'NOR', name: 'A', team: 'X', colour: '#f00' });
    b.drivers.set(81, { n: 81, code: 'PIA', name: 'B', team: 'X', colour: '#f00' });
    b.drivers.set(99, { n: 99, code: 'ZZZ', name: 'C', team: 'Y', colour: '#0f0' });
    b.pos.set(81, [[T, 1]]);
    b.pos.set(4, [[T, 2]]);
    b.ivl.set(4, [[T, 12.5, 1.2]]);
    b.ivl.set(81, [[T, null, null]]);
    b.laps.set(81, new Map([[7, { n: 7, start: T - 90_000, dur: 90, pitOut: false }]]));
    return b;
  }

  it('sorts rows by position with unplaced drivers last', () => {
    const rows = buildTiming(populated(), T).rows;
    expect(rows.map((r) => r.n)).toEqual([81, 4, 99]);
    expect(rows[2]!.p).toBeNull();
  });

  it('takes the leader lap from whichever row holds P1', () => {
    expect(buildTiming(populated(), T).lap).toBe(7);
  });

  it('leaves the leader lap null when no row holds P1', () => {
    const b = populated();
    b.pos.delete(81);
    expect(buildTiming(b, T).lap).toBeNull();
  });

  it('passes gap and interval through, including null for the leader', () => {
    const rows = buildTiming(populated(), T).rows;
    expect(rows[0]!.gap).toBeNull();
    expect(rows[1]!.gap).toBe(12.5);
    expect(rows[1]!.int).toBe(1.2);
  });

  it('passes a lapped driver string through untouched', () => {
    const b = populated();
    b.ivl.set(99, [[T, '+1 LAP', null]]);
    const row = buildTiming(b, T).rows.find((r: { n: number }) => r.n === 99)!;
    expect(row.gap).toBe('+1 LAP');
  });

  it('flags a car as in the pit lane for the lane duration', () => {
    const b = populated();
    b.pits.set(4, [[T - 5000, 22]]);
    expect(buildTiming(b, T).rows.find((r: { n: number }) => r.n === 4)!.pit).toBe(true);
    expect(buildTiming(b, T + 30_000).rows.find((r: { n: number }) => r.n === 4)!.pit).toBe(false);
  });

  it('returns the last four race control lines, newest first', () => {
    const b = populated();
    for (let i = 1; i <= 6; i++) b.rc.push([T - i * 1000, { message: `M${i}` }]);
    b.rc.sort((x, y) => x[0] - y[0]);
    expect(buildTiming(b, T).rc.map((r: { msg: string }) => r.msg)).toEqual(['M1', 'M2', 'M3', 'M4']);
  });
});

describe('buildTick', () => {
  it('includes replay meta only when replaying, and never timing', () => {
    const b = withLoc([[T, 1, 2, 3]]);
    const replay = { playing: true, speed: 1, start: T, end: T + 1000 };
    const tick = buildTick(b, { mode: 'replay', t: T, replay });
    expect(tick.replay).toEqual(replay);
    expect(tick.live).toBeUndefined();
    // Protocol v1 carries timing in its own event, so a tick never holds rows.
    expect('timing' in tick).toBe(false);
  });

  it('includes live meta when live', () => {
    const b = withLoc([[T, 1, 2, 3]]);
    const f = buildTick(b, { mode: 'live', t: T, live: { delayS: 10, mqtt: false } });
    expect(f.live).toEqual({ delayS: 10, mqtt: false });
    expect(f.mode).toBe('live');
  });
});

describe('the timing event', () => {
  it('carries its own timestamp, so the client can line it up with ticks', () => {
    expect(buildTiming(createBuffers(), T).t).toBe(T);
  });

  it('declares totalLaps, marshal sectors and battles, empty until later milestones', () => {
    const timing = buildTiming(createBuffers(), T);
    // OpenF1 publishes no total-lap figure; M3 fills marshal sectors, M4 battles.
    expect(timing.totalLaps).toBeNull();
    expect(timing.marshalSectors).toEqual([]);
    expect(timing.battles).toEqual([]);
  });
});
