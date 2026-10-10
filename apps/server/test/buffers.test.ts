import { describe, expect, it } from 'vitest';
import {
  bucket,
  createBuffers,
  insertSorted,
  lastAtOrBefore,
  num,
  prune,
  type CarRow,
  type LocRow,
} from '../src/feed/buffers.js';
import { ingest } from '../src/feed/ingest.js';

const KEY = 1002;
const loc = (t: string, n = 4, x = 10, y = 20, z = 30) => ({
  session_key: KEY,
  driver_number: n,
  date: t,
  x,
  y,
  z,
});

describe('lastAtOrBefore', () => {
  const arr: LocRow[] = [
    [100, 0, 0, 0],
    [200, 0, 0, 0],
    [300, 0, 0, 0],
  ];

  it('returns the last index at or before the target', () => {
    expect(lastAtOrBefore(arr, 250)).toBe(1);
  });

  it('returns the exact index on a direct hit', () => {
    expect(lastAtOrBefore(arr, 200)).toBe(1);
  });

  it('returns -1 when every row is later', () => {
    expect(lastAtOrBefore(arr, 99)).toBe(-1);
  });

  it('returns the final index when every row is earlier', () => {
    expect(lastAtOrBefore(arr, 10_000)).toBe(2);
  });

  it('returns -1 on an empty buffer', () => {
    expect(lastAtOrBefore([], 123)).toBe(-1);
  });

  it('returns the later of two equal timestamps', () => {
    // The invariant that keeps a duplicate pair from ever being the pair a frame
    // interpolates between, which would divide by a zero time delta.
    const dup: LocRow[] = [
      [100, 1, 1, 1],
      [200, 2, 2, 2],
      [200, 3, 3, 3],
      [300, 4, 4, 4],
    ];
    expect(lastAtOrBefore(dup, 200)).toBe(2);
    expect(lastAtOrBefore(dup, 250)).toBe(2);
    // So the bracket is [index 2, index 3], which has a non-zero span.
    const i = lastAtOrBefore(dup, 250);
    expect(dup[i + 1]![0] - dup[i]![0]).toBeGreaterThan(0);
  });
});

describe('insertSorted', () => {
  it('appends a row that is already in order', () => {
    const arr: LocRow[] = [[100, 0, 0, 0]];
    insertSorted(arr, [200, 0, 0, 0]);
    expect(arr.map((r) => r[0])).toEqual([100, 200]);
  });

  it('splices an out-of-order row into place', () => {
    const arr: LocRow[] = [
      [100, 0, 0, 0],
      [300, 0, 0, 0],
    ];
    insertSorted(arr, [200, 0, 0, 0]);
    expect(arr.map((r) => r[0])).toEqual([100, 200, 300]);
  });

  it('places an equal timestamp after the row already there', () => {
    const arr: LocRow[] = [[100, 1, 1, 1]];
    insertSorted(arr, [100, 2, 2, 2]);
    expect(arr[1]![1]).toBe(2);
  });

  it('handles an insert at the front', () => {
    const arr: LocRow[] = [[200, 0, 0, 0]];
    insertSorted(arr, [100, 0, 0, 0]);
    expect(arr.map((r) => r[0])).toEqual([100, 200]);
  });
});

describe('bucket and num', () => {
  it('creates a buffer on first use and reuses it after', () => {
    const m = new Map<number, LocRow[]>();
    const a = bucket(m, 4);
    a.push([1, 0, 0, 0]);
    expect(bucket(m, 4)).toBe(a);
    expect(bucket(m, 4)).toHaveLength(1);
  });

  it('passes finite numbers and rejects everything else', () => {
    expect(num(4)).toBe(4);
    expect(num(0)).toBe(0);
    expect(num(null)).toBeNull();
    expect(num(undefined)).toBeNull();
    expect(num('4')).toBeNull();
    expect(num(NaN)).toBeNull();
    expect(num(Infinity)).toBeNull();
  });
});

describe('ingest dedupe', () => {
  it('drops a repeated driver and date location row', () => {
    const b = createBuffers();
    const row = loc('2026-10-11T00:00:00.000Z');
    expect(ingest(b, KEY, 'location', [row])).toBe(1);
    expect(ingest(b, KEY, 'location', [row])).toBe(0);
    expect(b.loc.get(4)).toHaveLength(1);
  });

  it('keeps the same timestamp for a different driver', () => {
    const b = createBuffers();
    ingest(b, KEY, 'location', [loc('2026-10-11T00:00:00.000Z', 4), loc('2026-10-11T00:00:00.000Z', 81)]);
    expect(b.loc.get(4)).toHaveLength(1);
    expect(b.loc.get(81)).toHaveLength(1);
  });

  it('drops location rows sitting at 0,0,0, which mean no fix', () => {
    const b = createBuffers();
    expect(ingest(b, KEY, 'location', [loc('2026-10-11T00:00:00.000Z', 4, 0, 0, 0)])).toBe(0);
    expect(b.loc.has(4)).toBe(false);
  });

  it('keeps a location row that is zero on only some axes', () => {
    const b = createBuffers();
    expect(ingest(b, KEY, 'location', [loc('2026-10-11T00:00:00.000Z', 4, 0, 0, 5)])).toBe(1);
  });

  it('drops location and car rows with no date', () => {
    const b = createBuffers();
    expect(ingest(b, KEY, 'location', [{ session_key: KEY, driver_number: 4, x: 1, y: 2, z: 3 }])).toBe(0);
    expect(ingest(b, KEY, 'car_data', [{ session_key: KEY, driver_number: 4, speed: 300 }])).toBe(0);
  });

  it('drops rows belonging to another session', () => {
    const b = createBuffers();
    expect(ingest(b, KEY, 'location', [{ ...loc('2026-10-11T00:00:00.000Z'), session_key: 1001 }])).toBe(0);
  });

  it('keeps rows that carry no session_key at all', () => {
    const b = createBuffers();
    const { session_key, ...row } = loc('2026-10-11T00:00:00.000Z');
    void session_key;
    expect(ingest(b, KEY, 'location', [row])).toBe(1);
  });

  it('stores car data in upstream order: speed, rpm, gear', () => {
    const b = createBuffers();
    ingest(b, KEY, 'car_data', [
      {
        session_key: KEY,
        driver_number: 4,
        date: '2026-10-11T00:00:00.000Z',
        speed: 310,
        rpm: 11200,
        n_gear: 7,
        throttle: 100,
        brake: 0,
        drs: 0,
      },
    ]);
    const row = b.car.get(4)![0] as CarRow;
    expect([row[1], row[2], row[3]]).toEqual([310, 11200, 7]);
  });
});

describe('ingest upserts', () => {
  it('upserts a lap by driver and lap number as sectors complete', () => {
    const b = createBuffers();
    const base = { session_key: KEY, driver_number: 4, lap_number: 12, date_start: '2026-10-11T00:00:00.000Z' };
    ingest(b, KEY, 'laps', [{ ...base, lap_duration: null }]);
    expect(b.laps.get(4)!.get(12)!.dur).toBeNull();
    ingest(b, KEY, 'laps', [{ ...base, lap_duration: 92.431 }]);
    expect(b.laps.get(4)!.size).toBe(1);
    expect(b.laps.get(4)!.get(12)!.dur).toBe(92.431);
  });

  it('records a pit-out lap', () => {
    const b = createBuffers();
    ingest(b, KEY, 'laps', [
      { session_key: KEY, driver_number: 4, lap_number: 8, date_start: '2026-10-11T00:00:00.000Z', is_pit_out_lap: true },
    ]);
    expect(b.laps.get(4)!.get(8)!.pitOut).toBe(true);
  });

  it('ignores a lap row with no lap number', () => {
    const b = createBuffers();
    expect(ingest(b, KEY, 'laps', [{ session_key: KEY, driver_number: 4 }])).toBe(0);
  });

  it('upserts a stint by stint number and defaults its fields', () => {
    const b = createBuffers();
    ingest(b, KEY, 'stints', [{ session_key: KEY, driver_number: 4, stint_number: 2, compound: 'HARD' }]);
    const s = b.stints.get(4)!.get(2)!;
    expect(s).toEqual({ compound: 'HARD', start: 1, end: null, age0: 0 });
  });

  it('falls back lane_duration, then pit_duration, then 22 seconds', () => {
    const b = createBuffers();
    const at = (d: string, extra: Record<string, unknown>) => ({
      session_key: KEY,
      driver_number: 4,
      date: d,
      ...extra,
    });
    ingest(b, KEY, 'pit', [at('2026-10-11T00:00:00.000Z', { lane_duration: 21.8, pit_duration: 30 })]);
    ingest(b, KEY, 'pit', [at('2026-10-11T00:01:00.000Z', { lane_duration: null, pit_duration: 24.5 })]);
    ingest(b, KEY, 'pit', [at('2026-10-11T00:02:00.000Z', {})]);
    expect(b.pits.get(4)!.map((r) => r[1])).toEqual([21.8, 24.5, 22]);
  });

  it('builds a driver, falling back to the number and the haze colour', () => {
    const b = createBuffers();
    ingest(b, KEY, 'drivers', [
      { session_key: KEY, driver_number: 4, name_acronym: 'NOR', full_name: 'Lando NORRIS', team_name: 'X', team_colour: 'FF8000' },
      { session_key: KEY, driver_number: 99 },
    ]);
    expect(b.drivers.get(4)).toEqual({ n: 4, code: 'NOR', name: 'Lando NORRIS', team: 'X', colour: '#FF8000' });
    expect(b.drivers.get(99)).toEqual({ n: 99, code: '99', name: '99', team: '', colour: '#9aa4ae' });
  });

  it('dedupes a race control message by date and text', () => {
    const b = createBuffers();
    const row = { session_key: KEY, date: '2026-10-11T00:00:00.000Z', message: 'SAFETY CAR DEPLOYED' };
    expect(ingest(b, KEY, 'race_control', [row])).toBe(1);
    expect(ingest(b, KEY, 'race_control', [row])).toBe(0);
    expect(b.rc).toHaveLength(1);
  });

  it('ignores an unknown topic rather than throwing', () => {
    const b = createBuffers();
    expect(ingest(b, KEY, 'weather', [{ session_key: KEY, air_temperature: 28 }])).toBe(0);
  });
});

describe('prune', () => {
  it('drops location and car samples over 90 s behind the clock', () => {
    const b = createBuffers();
    const clockMs = 1_000_000;
    const keep = clockMs - 10_000;
    const drop = clockMs - 120_000;
    b.loc.set(4, [
      [drop, 1, 1, 1],
      [keep, 2, 2, 2],
    ]);
    b.car.set(4, [[drop, 1, 1, 1, 1, 1, 1]]);
    prune(b, clockMs);
    expect(b.loc.get(4)).toHaveLength(1);
    expect(b.loc.get(4)![0]![0]).toBe(keep);
    expect(b.car.get(4)).toHaveLength(0);
  });

  it('leaves the other buffers alone, since they are small and needed whole', () => {
    const b = createBuffers();
    b.pos.set(4, [[1, 1]]);
    b.rc.push([1, { message: 'GREEN' }]);
    prune(b, 1_000_000);
    expect(b.pos.get(4)).toHaveLength(1);
    expect(b.rc).toHaveLength(1);
  });

  it('clears a seen set once it passes 200,000 keys', () => {
    const b = createBuffers();
    for (let i = 0; i < 200_001; i++) b.seen.location.add(`k${i}`);
    prune(b, 0);
    expect(b.seen.location.size).toBe(0);
  });

  it('keeps a seen set that is still small', () => {
    const b = createBuffers();
    b.seen.location.add('k');
    prune(b, 0);
    expect(b.seen.location.size).toBe(1);
  });
});
