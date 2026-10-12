// The flag state machine, tested against the wording OpenF1 really uses.
//
// The existing trackFlag tests fed it "VIRTUAL SAFETY CAR DEPLOYED", which is
// not what the feed sends. Singapore 2026 sent "VSC DEPLOYED" twice and both
// periods were reported as a full safety car.

import { describe, expect, it } from 'vitest';
import { createBuffers, type Buffers } from '../src/feed/buffers.js';
import { flagState, trackFlag } from '../src/derive/flags.js';
import type { RaceControlRow } from '@lapline/shared';

const T = 1_000_000;

/** Race control rows at offsets from T, in the order they were sent. */
function rc(rows: Array<[offsetS: number, row: Partial<RaceControlRow>]>): Buffers {
  const b = createBuffers();
  b.rc = rows.map(([at, r]) => [T + at * 1000, r as RaceControlRow]);
  return b;
}

const sc = (message: string): Partial<RaceControlRow> => ({ category: 'SafetyCar', message });
const flag = (f: string, scope = 'Track'): Partial<RaceControlRow> => ({ category: 'Flag', scope, flag: f });

describe('the wording Singapore 2026 actually sent', () => {
  // The two real sequences, verbatim from race_control for session 11388.
  const singapore = rc([
    [0, flag('GREEN')],
    [60, sc('VSC DEPLOYED')],
    [125, sc('VSC ENDING')],
    [139, flag('CLEAR')],
    [3000, sc('VSC DEPLOYED')],
    [3119, sc('VSC ENDING')],
  ]);

  it('reads VSC DEPLOYED as a virtual safety car, not a full one', () => {
    expect(trackFlag(singapore, T + 90_000)).toBe('VSC');
  });

  it('reads VSC ENDING as the virtual one ending', () => {
    expect(trackFlag(singapore, T + 130_000)).toBe('VSC ENDING');
  });

  it('goes green again on the track clear that follows', () => {
    expect(trackFlag(singapore, T + 200_000)).toBe('GREEN');
  });

  it('handles the second period the same way', () => {
    expect(trackFlag(singapore, T + 3_050_000)).toBe('VSC');
    expect(trackFlag(singapore, T + 3_150_000)).toBe('VSC ENDING');
  });

  it('still understands the spelt-out form, which race control also uses', () => {
    const spelt = rc([[0, sc('VIRTUAL SAFETY CAR DEPLOYED')]]);
    expect(trackFlag(spelt, T + 10_000)).toBe('VSC');
  });

  it('does not mistake a real safety car for a virtual one', () => {
    const real = rc([[0, sc('SAFETY CAR DEPLOYED')]]);
    expect(trackFlag(real, T + 10_000)).toBe('SC');
  });

  it('keeps a VSC ending as virtual when a second ending message follows', () => {
    const twice = rc([[0, sc('VSC DEPLOYED')], [60, sc('VSC ENDING')], [70, sc('SAFETY CAR IN THIS LAP')]]);
    expect(trackFlag(twice, T + 80_000)).toBe('VSC ENDING');
  });
});

describe('every state the band draws', () => {
  const cases: Array<[string, Partial<RaceControlRow>, string]> = [
    ['green', flag('GREEN'), 'GREEN'],
    ['track yellow', flag('YELLOW'), 'YELLOW'],
    ['red', flag('RED'), 'RED'],
    ['chequered', flag('CHEQUERED'), 'CHEQUERED'],
    ['safety car', sc('SAFETY CAR DEPLOYED'), 'SC'],
    ['virtual safety car', sc('VSC DEPLOYED'), 'VSC'],
  ];

  for (const [name, row, want] of cases) {
    it(`reports ${name}`, () => {
      expect(trackFlag(rc([[0, row]]), T + 10_000)).toBe(want);
    });
  }

  it('reports the two ending states', () => {
    expect(trackFlag(rc([[0, sc('SAFETY CAR DEPLOYED')], [60, sc('SAFETY CAR IN THIS LAP')]]), T + 70_000)).toBe(
      'SC ENDING',
    );
    expect(trackFlag(rc([[0, sc('VSC DEPLOYED')], [60, sc('VSC ENDING')]]), T + 70_000)).toBe('VSC ENDING');
  });

  it('ignores a sector-scoped yellow, which colours a marshal sector instead', () => {
    expect(trackFlag(rc([[0, flag('YELLOW', 'Sector')]]), T + 10_000)).toBe('GREEN');
  });
});

describe('when the flag began', () => {
  /** A leader whose laps start every 90 s from T. */
  function withLaps(b: Buffers, count = 40): Buffers {
    const m = new Map();
    for (let n = 1; n <= count; n++) m.set(n, { n, start: T + (n - 1) * 90_000, dur: 90, pitOut: false, sectors: null });
    b.laps.set(1, m);
    return b;
  }

  it('is null while the track has only ever been green', () => {
    expect(flagState(rc([[0, flag('GREEN')]]), T + 10_000)).toMatchObject({ flag: 'GREEN', since: null });
  });

  it('names the moment the safety car came out', () => {
    const b = withLaps(rc([[0, flag('GREEN')], [900, sc('SAFETY CAR DEPLOYED')]]));
    const state = flagState(b, T + 1_000_000);
    expect(state.flag).toBe('SC');
    expect(state.since).toBe(T + 900_000);
  });

  it('names the leader lap it came out on', () => {
    // 900 s in, at 90 s a lap, the leader has started lap 11.
    const b = withLaps(rc([[0, flag('GREEN')], [900, sc('SAFETY CAR DEPLOYED')]]));
    expect(flagState(b, T + 1_000_000).sinceLap).toBe(11);
  });

  it('moves the moment on when the flag changes again', () => {
    const b = withLaps(rc([[900, sc('SAFETY CAR DEPLOYED')], [1200, sc('SAFETY CAR IN THIS LAP')]]));
    expect(flagState(b, T + 1_300_000).since).toBe(T + 1_200_000);
  });

  it('holds the moment while repeated messages say the same thing', () => {
    const b = withLaps(rc([[900, sc('SAFETY CAR DEPLOYED')], [1000, sc('SAFETY CAR DEPLOYED')]]));
    expect(flagState(b, T + 1_300_000).since).toBe(T + 900_000);
  });

  it('gives no lap when none has started yet', () => {
    const b = rc([[900, flag('RED')]]);
    expect(flagState(b, T + 1_000_000)).toMatchObject({ flag: 'RED', sinceLap: null });
  });
});
