// Practice and qualifying: deleted laps, segments and knockouts.
//
// Checked end to end against Austin 2026 qualifying, where every row's time
// matched OpenF1's session_result at the end of Q1, Q2 and Q3. These pin the
// rules that got it there, on data small enough to read.

import { describe, expect, it } from 'vitest';
import { qualifyingCut, type RaceControlRow } from '@lapline/shared';
import { createBuffers, type Buffers } from '../src/feed/buffers.js';
import { currentLap, deletedLaps, lapColour, WHOLE_SESSION } from '../src/derive/laps.js';
import { knockedOut, segmentScope, segments } from '../src/derive/qualifying.js';
import { buildTiming } from '../src/feed/frames.js';

const T = 1_000_000;
const S = 1000;

/** Laps for one driver: [lap number, start offset in s, duration, pit-out?]. */
function lap(b: Buffers, n: number, laps: Array<[lap: number, at: number, dur: number, pitOut?: boolean]>): void {
  const m = b.laps.get(n) ?? new Map();
  for (const [ln, at, dur, pitOut] of laps) m.set(ln, { n: ln, start: T + at * S, dur, pitOut: Boolean(pitOut), sectors: null });
  b.laps.set(n, m);
}

function rc(b: Buffers, at: number, row: Partial<RaceControlRow>): void {
  b.rc.push([T + at * S, row]);
  b.rc.sort((x, y) => x[0] - y[0]);
}

const started = (b: Buffers, at: number, phase: number): void =>
  rc(b, at, { category: 'SessionStatus', message: 'SESSION STARTED', qualifying_phase: phase });

describe('deletedLaps', () => {
  it('finds the deleted lap by its time, which race control numbers one lap late', () => {
    // Austin 2026: "CAR 10 (GAS) TIME 1:36.764 DELETED ... LAP 3" is OpenF1's lap 2.
    const b = createBuffers();
    lap(b, 10, [[2, 0, 96.764], [3, 97, 130.977]]);
    rc(b, 230, { message: 'CAR 10 (GAS) TIME 1:36.764 DELETED - TRACK LIMITS AT TURN 9 LAP 3 16:07:14' });
    expect(deletedLaps(b, T + 300 * S)).toEqual(new Set(['10|2']));
  });

  it('takes the lap before the one named when the message gives no time', () => {
    const b = createBuffers();
    lap(b, 5, [[8, 0, 126.4], [9, 127, 362.5]]);
    rc(b, 500, { message: 'CAR 5 (BOR) LAP DELETED - TRACK LIMITS AT TURN 11 LAP 9 16:29:31 (PIT)' });
    expect(deletedLaps(b, T + 600 * S)).toEqual(new Set(['5|8']));
  });

  it('gives a lap back when race control reinstates it', () => {
    const b = createBuffers();
    lap(b, 10, [[2, 0, 96.764]]);
    rc(b, 100, { message: 'CAR 10 (GAS) TIME 1:36.764 DELETED - TRACK LIMITS AT TURN 9 LAP 3' });
    rc(b, 200, { message: 'CAR 10 (GAS) TIME 1:36.764 REINSTATED LAP 3' });
    expect(deletedLaps(b, T + 150 * S)).toEqual(new Set(['10|2']));
    expect(deletedLaps(b, T + 250 * S)).toEqual(new Set());
  });

  it('takes a deleted lap out of the best and the colours', () => {
    const b = createBuffers();
    lap(b, 87, [[13, 0, 96.2], [14, 100, 95.592]]);
    lap(b, 4, [[1, 0, 95.9]]);
    rc(b, 300, { message: 'CAR 87 (BEA) TIME 1:35.592 DELETED - TRACK LIMITS AT TURN 11 LAP 15' });
    const t = T + 400 * S;
    const scope = { ...WHOLE_SESSION, deleted: deletedLaps(b, t) };
    expect(currentLap(b, 87, t, scope).best).toBe(96.2);
    expect(lapColour(b, 87, t, scope)).toBeNull();
    expect(lapColour(b, 4, t, scope)).toBe('fastest');
  });
});

describe('segments', () => {
  it('is empty outside qualifying', () => {
    const b = createBuffers();
    rc(b, 0, { category: 'SessionStatus', message: 'SESSION STARTED' });
    expect(segments(b, T + 10 * S)).toEqual([]);
  });

  it('opens each segment at its first SESSION STARTED, so a red flag restart does not move it', () => {
    const b = createBuffers();
    started(b, 0, 1);
    started(b, 600, 1);
    started(b, 1500, 2);
    expect(segments(b, T + 2000 * S)).toEqual([
      { phase: 1, from: T, to: T + 1500 * S },
      { phase: 2, from: T + 1500 * S, to: Infinity },
    ]);
    expect(segments(b, T + 1000 * S).map((s) => s.phase)).toEqual([1]);
  });
});

describe('qualifyingCut', () => {
  it('sends 16 and then 10 through from 22 cars, and 15 and 10 from 20', () => {
    expect([qualifyingCut(22, 1), qualifyingCut(22, 2), qualifyingCut(22, 3)]).toEqual([16, 10, null]);
    expect([qualifyingCut(20, 1), qualifyingCut(20, 2)]).toEqual([15, 10]);
  });
});

/** Twelve cars, so Q1 keeps 11 and knocks out one; segments at 0 and 1000 s. */
function twelveCars(): Buffers {
  const b = createBuffers();
  for (let n = 1; n <= 12; n++) {
    b.drivers.set(n, { n, code: `C${n}`, name: '', team: '', colour: '#fff' });
    b.pos.set(n, [[T + 500 * S, n]]);
    lap(b, n, [[1, 0, 90 + n]]);
  }
  started(b, 0, 1);
  started(b, 1000, 2);
  return b;
}

describe('knockedOut', () => {
  it('cuts at the order when the next segment starts', () => {
    const b = twelveCars();
    expect(knockedOut(b, segments(b, T + 1100 * S))).toEqual(new Map([[12, 1]]));
  });

  it('believes a lap in the next segment over the order', () => {
    const b = twelveCars();
    lap(b, 12, [[2, 1050, 95]]);
    expect(knockedOut(b, segments(b, T + 1200 * S))).toEqual(new Map());
  });
});

describe('the tower in qualifying', () => {
  it('times each driver from the segment that places them, and says who is out', () => {
    const b = twelveCars();
    // Car 1 went quicker in Q1 than it has managed in Q2; Q2 is what counts.
    lap(b, 1, [[2, 1050, 93.5]]);
    lap(b, 2, [[2, 1050, 92.8]]);
    const f = buildTiming(b, T + 1200 * S);
    const row = (n: number) => f.rows.find((r) => r.n === n)!;

    expect(f.phase).toBe(2);
    expect(row(1)).toMatchObject({ best: 93.5, outIn: null });
    expect(row(2)).toMatchObject({ best: 92.8, outIn: null, lapFlag: 'fastest' });
    expect(row(3)).toMatchObject({ best: null, outIn: null });
    expect(row(12)).toMatchObject({ best: 102, outIn: 1, lapFlag: null });
  });

  it('is the whole session, and no phase, anywhere else', () => {
    const b = createBuffers();
    b.drivers.set(1, { n: 1, code: 'C1', name: '', team: '', colour: '#fff' });
    lap(b, 1, [[1, 0, 95], [2, 95, 93], [3, 188, 99]]);
    const f = buildTiming(b, T + 400 * S);
    expect(f.phase).toBeNull();
    expect(f.rows[0]).toMatchObject({ best: 93, outIn: null });
  });

  it('scopes a segment that has not started to no laps at all', () => {
    expect(segmentScope([], 2, new Set())).toMatchObject({ from: Infinity, to: Infinity });
  });
});
