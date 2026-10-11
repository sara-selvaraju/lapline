// The store's rules, independent of any component.

import { beforeEach, describe, expect, it } from 'vitest';
import type { Hello, Tick, Timing } from '@lapline/shared';
import { useStore } from '../src/store/store.js';

const T = 1_760_000_000_000;

const hello = (over: Partial<Hello> = {}): Hello => ({
  protocolVersion: 1,
  session: { key: 1002, name: 'Race', circuit: 'Singapore', country: 'Singapore', start: T, end: T + 1 },
  mode: 'live',
  userPicked: false,
  drivers: [
    { n: 4, code: 'NOR', name: 'A', team: 'X', colour: '#f00' },
    { n: 81, code: 'PIA', name: 'B', team: 'X', colour: '#f00' },
  ],
  sessions: [],
  circuit: null,
  status: { level: 'ok', text: 'Live', mode: 'live', api: { auth: 'ok', requests: 1, last: null }, freshness: T },
  canLive: true,
  ...over,
});

const tick = (over: Partial<Tick> = {}): Tick => ({
  t: T,
  mode: 'live',
  cars: [[4, 1, 2, 3, 300, 7, 11000, 100, 0, 0, 0]],
  ...over,
});

const timing = (over: Partial<Timing> = {}): Timing => ({
  t: T,
  rows: [
    { n: 81, p: 1, gap: null, int: null, lap: 5, last: 92, best: 92, tyre: 'SOFT', age: 2, pit: false },
    { n: 4, p: 2, gap: 1.2, int: 1.2, lap: 5, last: 93, best: 92.5, tyre: 'HARD', age: 9, pit: false },
  ],
  lap: 5,
  totalLaps: null,
  flag: 'GREEN',
  marshalSectors: [],
  rc: [],
  battles: [],
  ...over,
});

const reset = (): void => {
  useStore.setState({
    session: null, sessions: [], mode: 'idle', drivers: new Map(), circuit: null, transform: null,
    status: null, canLive: false, tick: null, timing: null, timingByN: new Map(), replay: null,
    live: null, sel: null, follow: false, scrubbing: false, history: [], circuitEpoch: 0,
  });
};

beforeEach(reset);

describe('applyHello', () => {
  it('indexes drivers by number', () => {
    useStore.getState().applyHello(hello());
    expect(useStore.getState().drivers.get(4)?.code).toBe('NOR');
    expect(useStore.getState().drivers.size).toBe(2);
  });

  it('clears timing and the trace when the session changes', () => {
    useStore.getState().applyHello(hello());
    useStore.getState().applyTiming(timing());
    useStore.getState().applyTick(tick());
    expect(useStore.getState().timing).not.toBeNull();

    useStore.getState().applyHello(hello({ session: { key: 9, name: 'Q', circuit: 'c', country: 'c', start: 1, end: 2 } }));
    expect(useStore.getState().timing).toBeNull();
    expect(useStore.getState().history).toEqual([]);
  });

  it('bumps the circuit epoch on a session change, so the scene rebuilds', () => {
    useStore.getState().applyHello(hello());
    const before = useStore.getState().circuitEpoch;
    useStore.getState().applyHello(hello({ session: { key: 9, name: 'Q', circuit: 'c', country: 'c', start: 1, end: 2 } }));
    expect(useStore.getState().circuitEpoch).toBeGreaterThan(before);
  });

  it('leaves timing alone when the same session says hello again', () => {
    useStore.getState().applyHello(hello());
    useStore.getState().applyTiming(timing());
    useStore.getState().applyHello(hello());
    expect(useStore.getState().timing).not.toBeNull();
  });
});

describe('applyCircuit', () => {
  const circuit = { points: [[1, 2, 3]] as [number, number, number][], transform: { cx: 0, cy: 0, cz: 0, scale: 1 }, source: 'Sprint' };

  it('stores the outline and its transform', () => {
    useStore.getState().applyCircuit(circuit);
    expect(useStore.getState().circuit?.source).toBe('Sprint');
    expect(useStore.getState().transform?.scale).toBe(1);
  });

  it('bumps the epoch only when the transform actually changed', () => {
    useStore.getState().applyCircuit(circuit);
    const after = useStore.getState().circuitEpoch;
    useStore.getState().applyCircuit({ ...circuit, source: 'Qualifying' });
    expect(useStore.getState().circuitEpoch).toBe(after);
    useStore.getState().applyCircuit({ ...circuit, transform: { cx: 5, cy: 0, cz: 0, scale: 1 } });
    expect(useStore.getState().circuitEpoch).toBe(after + 1);
  });
});

describe('applyTick', () => {
  it('records mode, replay and live meta', () => {
    useStore.getState().applyTick(tick({ live: { delayS: 10, mqtt: false } }));
    expect(useStore.getState().mode).toBe('live');
    expect(useStore.getState().live).toEqual({ delayS: 10, mqtt: false });
    expect(useStore.getState().replay).toBeNull();
  });

  it('builds the speed trace for the selected car only', () => {
    useStore.getState().select(4, false);
    useStore.getState().applyTick(tick());
    useStore.getState().applyTick(tick({ t: T + 250 }));
    expect(useStore.getState().history).toHaveLength(2);
    expect(useStore.getState().history[0]![1]).toBe(300);
  });

  it('records nothing when the selected car is not in the frame', () => {
    useStore.getState().select(99, false);
    useStore.getState().applyTick(tick());
    expect(useStore.getState().history).toHaveLength(0);
  });

  it('drops samples older than 30 seconds of session time', () => {
    useStore.getState().select(4, false);
    useStore.getState().applyTick(tick());
    useStore.getState().applyTick(tick({ t: T + 31_000 }));
    expect(useStore.getState().history).toHaveLength(1);
    expect(useStore.getState().history[0]![0]).toBe(T + 31_000);
  });

  it('restarts the trace when the clock jumps backwards, as a seek does', () => {
    useStore.getState().select(4, false);
    useStore.getState().applyTick(tick());
    useStore.getState().applyTick(tick({ t: T + 250 }));
    useStore.getState().applyTick(tick({ t: T - 600_000 }));
    expect(useStore.getState().history).toHaveLength(1);
    expect(useStore.getState().history[0]![0]).toBe(T - 600_000);
  });
});

describe('applyTiming', () => {
  it('indexes rows by driver number', () => {
    useStore.getState().applyTiming(timing());
    expect(useStore.getState().timingByN.get(4)?.p).toBe(2);
  });

  it('selects the leader when nothing is chosen yet', () => {
    expect(useStore.getState().sel).toBeNull();
    useStore.getState().applyTiming(timing());
    expect(useStore.getState().sel).toBe(81);
  });

  it('leaves an existing selection alone', () => {
    useStore.getState().select(4, false);
    useStore.getState().applyTiming(timing());
    expect(useStore.getState().sel).toBe(4);
  });

  it('does not select anything when no row holds a position', () => {
    useStore.getState().applyTiming(timing({ rows: [{ ...timing().rows[0]!, p: null }] }));
    expect(useStore.getState().sel).toBeNull();
  });
});

describe('select', () => {
  it('clears the trace when the driver changes, and keeps it when it does not', () => {
    useStore.getState().select(4, false);
    useStore.getState().applyTick(tick());
    expect(useStore.getState().history).toHaveLength(1);

    useStore.getState().select(4, false);
    expect(useStore.getState().history).toHaveLength(1);

    useStore.getState().select(81, false);
    expect(useStore.getState().history).toHaveLength(0);
  });
});

describe('preferences', () => {
  it('bumps the circuit epoch when elevation changes, so the track is rebuilt', () => {
    const before = useStore.getState().circuitEpoch;
    useStore.getState().setZx(8);
    expect(useStore.getState().zx).toBe(8);
    expect(useStore.getState().circuitEpoch).toBe(before + 1);
  });

  it('toggles gap mode, labels and follow', () => {
    useStore.getState().setGapMode('gap');
    useStore.getState().setAllLabels(true);
    useStore.getState().setFollow(true);
    expect(useStore.getState().gapMode).toBe('gap');
    expect(useStore.getState().allLabels).toBe(true);
    expect(useStore.getState().follow).toBe(true);
  });

  it('survives localStorage being unavailable', () => {
    const original = globalThis.localStorage;
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() {
        throw new Error('blocked');
      },
    });
    try {
      expect(() => useStore.getState().setGapMode('gap')).not.toThrow();
      expect(useStore.getState().gapMode).toBe('gap');
    } finally {
      Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: original });
    }
  });
});
