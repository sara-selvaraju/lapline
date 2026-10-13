import { describe, expect, it } from 'vitest';
import {
  CarTupleSchema,
  CircuitSchema,
  ControlRequestSchema,
  EVENT_SCHEMAS,
  HelloSchema,
  PROTOCOL_VERSION,
  SSE_EVENTS,
  StatusSchema,
  TickSchema,
  TimingSchema,
  isSseEvent,
} from '../src/index.js';

const status = {
  level: 'ok',
  text: 'Live',
  mode: 'live',
  api: { auth: 'ok', requests: 12, last: '200 location' },
  freshness: 1_760_000_000_000,
};

const hello = {
  protocolVersion: PROTOCOL_VERSION,
  session: { key: 1002, name: 'Race', circuit: 'Singapore', country: 'Singapore', start: 1, end: 2 },
  mode: 'live',
  userPicked: false,
  drivers: [{ n: 4, code: 'NOR', name: 'Lando NORRIS', team: 'McLaren', colour: '#F47600' }],
  sessions: [
    {
      key: 1002,
      label: 'Singapore race',
      name: 'Race',
      meeting: 'Singapore',
      meetingKey: 1296,
      start: '2026-10-11T12:00:00+00:00',
      live: true,
    },
  ],
  circuit: {
    points: [[1, 2, 3]],
    transform: { cx: 0, cy: 0, cz: 0, scale: 1 },
    source: 'Qualifying',
    turns: [{ number: 1, index: 0 }],
    sectors: [{ label: 'S1', index: 0 }],
    marshalSectors: [{ number: 1, index: 0 }],
    pitLane: [],
    detailSource: 'circuit-file',
  },
  status,
  canLive: true,
  result: null,
};

const tick = {
  t: 1_760_000_000_000,
  mode: 'live',
  cars: [[4, 10, 20, 30, 310, 7, 11200, 100, 0, 0, 0]],
  live: { delayS: 10, mqtt: false },
};

const timing = {
  t: 1_760_000_000_000,
  rows: [
    { n: 4, p: 1, gap: null, int: null, lap: 7, last: 92.4, best: 92.4, tyre: 'SOFT', age: 3, pit: false, lapFlag: 'pb', stops: 1 },
  ],
  lap: 7,
  totalLaps: null,
  flag: 'GREEN',
  marshalSectors: [],
  rc: [{ t: 1, msg: 'GREEN LIGHT' }],
  battles: [],
  flagSince: null,
  flagSinceLap: null,
};

describe('the protocol surface', () => {
  it('is version 6', () => {
    expect(PROTOCOL_VERSION).toBe(6);
  });

  it('names six events, and has a schema for each', () => {
    expect(SSE_EVENTS).toEqual(['hello', 'tick', 'timing', 'status', 'circuit', 'ping']);
    for (const e of SSE_EVENTS) expect(EVENT_SCHEMAS[e]).toBeDefined();
  });

  it('recognises its own event names and rejects others', () => {
    expect(isSseEvent('tick')).toBe(true);
    expect(isSseEvent('init')).toBe(false);
  });
});

describe('valid messages parse', () => {
  it('accepts hello, tick, timing, status and circuit', () => {
    expect(HelloSchema.safeParse(hello).success).toBe(true);
    expect(TickSchema.safeParse(tick).success).toBe(true);
    expect(TimingSchema.safeParse(timing).success).toBe(true);
    expect(StatusSchema.safeParse(status).success).toBe(true);
    expect(CircuitSchema.safeParse(hello.circuit).success).toBe(true);
  });

  it('accepts a session that has not been chosen yet', () => {
    expect(HelloSchema.safeParse({ ...hello, session: null, circuit: null }).success).toBe(true);
  });

  it('accepts a replay tick, and one with neither meta block', () => {
    const replay = { playing: true, speed: 8, start: 1, end: 2 };
    expect(TickSchema.safeParse({ t: 1, mode: 'replay', cars: [], replay }).success).toBe(true);
    expect(TickSchema.safeParse({ t: 1, mode: 'idle', cars: [] }).success).toBe(true);
  });

  it('accepts the lapped-driver text upstream sends instead of a number', () => {
    const lapped = { ...timing.rows[0]!, n: 81, p: 20, gap: '+1 LAP', int: null };
    expect(TimingSchema.safeParse({ ...timing, rows: [lapped] }).success).toBe(true);
  });

  it('accepts a freshness of null, before any row has arrived', () => {
    expect(StatusSchema.safeParse({ ...status, freshness: null }).success).toBe(true);
  });

  it('accepts freeAt only where locked mode sets it, and tolerates its absence', () => {
    expect(StatusSchema.safeParse({ ...status, freeAt: '2026-10-11T03:27:06.694Z' }).success).toBe(true);
    expect(StatusSchema.safeParse(status).success).toBe(true);
  });
});

describe('malformed messages are rejected', () => {
  it('rejects an unknown mode or flag', () => {
    expect(TickSchema.safeParse({ ...tick, mode: 'paused' }).success).toBe(false);
    expect(TimingSchema.safeParse({ ...timing, flag: 'BLUE' }).success).toBe(false);
  });

  it('rejects a missing required field', () => {
    const { mode, ...noMode } = tick;
    void mode;
    expect(TickSchema.safeParse(noMode).success).toBe(false);
    const { rows, ...noRows } = timing;
    void rows;
    expect(TimingSchema.safeParse(noRows).success).toBe(false);
  });

  it('rejects a field of the wrong type', () => {
    expect(TickSchema.safeParse({ ...tick, t: '1760000000000' }).success).toBe(false);
    expect(StatusSchema.safeParse({ ...status, api: { ...status.api, requests: 'twelve' } }).success).toBe(false);
  });

  it('rejects the v1 boolean where v2 wants an auth state', () => {
    const { auth, ...rest } = status.api;
    void auth;
    expect(StatusSchema.safeParse({ ...status, api: { ...rest, authed: true } }).success).toBe(false);
    expect(StatusSchema.safeParse({ ...status, api: { ...status.api, auth: 'yes' } }).success).toBe(false);
  });

  it('rejects null where null is not allowed', () => {
    expect(TimingSchema.safeParse({ ...timing, flag: null }).success).toBe(false);
    expect(TickSchema.safeParse({ ...tick, cars: null }).success).toBe(false);
  });

  it('rejects a tower row missing its driver number', () => {
    const { n, ...noN } = timing.rows[0]!;
    void n;
    expect(TimingSchema.safeParse({ ...timing, rows: [noN] }).success).toBe(false);
  });

  it('rejects a race control line with no message, which must be a string not null', () => {
    expect(TimingSchema.safeParse({ ...timing, rc: [{ t: 1, msg: null }] }).success).toBe(false);
  });

  it('rejects garbage entirely', () => {
    for (const junk of [null, undefined, 42, 'tick', [], { nope: true }]) {
      expect(TickSchema.safeParse(junk).success).toBe(false);
    }
  });
});

describe('the car tuple', () => {
  const car = [4, 10, 20, 30, 310, 7, 11200, 100, 0, 0, 0];

  it('accepts a full tuple and one with every telemetry field null', () => {
    expect(CarTupleSchema.safeParse(car).success).toBe(true);
    expect(CarTupleSchema.safeParse([4, 1, 2, 3, null, null, null, null, null, null, 1]).success).toBe(true);
  });

  it('rejects the wrong length, which is how a field-order change would show', () => {
    expect(CarTupleSchema.safeParse(car.slice(0, 10)).success).toBe(false);
    expect(CarTupleSchema.safeParse([...car, 99]).success).toBe(false);
  });

  it('rejects a stale flag that is not 0 or 1', () => {
    expect(CarTupleSchema.safeParse([...car.slice(0, 10), 2]).success).toBe(false);
    expect(CarTupleSchema.safeParse([...car.slice(0, 10), true]).success).toBe(false);
  });

  it('rejects a non-integer driver number', () => {
    expect(CarTupleSchema.safeParse([4.5, ...car.slice(1)]).success).toBe(false);
  });
});

describe('the auth state', () => {
  it('distinguishes configured from working, which a boolean could not', () => {
    for (const auth of ['none', 'pending', 'ok', 'rejected']) {
      expect(StatusSchema.safeParse({ ...status, api: { ...status.api, auth } }).success).toBe(true);
    }
  });
});

describe('the version check', () => {
  it('parses a hello from a different protocol version, so the client can compare and reload', () => {
    // The field must survive parsing: refusing it would leave the client unable
    // to tell a version mismatch from a corrupt frame.
    const other = HelloSchema.safeParse({ ...hello, protocolVersion: 99 });
    expect(other.success).toBe(true);
    expect(other.success && other.data.protocolVersion).toBe(99);
  });
});

describe('control requests', () => {
  it('accepts each control the UI sends', () => {
    for (const body of [
      { session: 1002 },
      { session: 1002, mode: 'replay' },
      { follow: 'auto' },
      { playing: false },
      { speed: 8 },
      { at: 1_760_000_000_000 },
      { delayS: 15 },
      {},
    ]) {
      expect(ControlRequestSchema.safeParse(body).success).toBe(true);
    }
  });

  it('rejects a mode or follow value it does not know', () => {
    expect(ControlRequestSchema.safeParse({ session: 1, mode: 'locked' }).success).toBe(false);
    expect(ControlRequestSchema.safeParse({ follow: 'manual' }).success).toBe(false);
  });

  it('rejects the wrong type for a numeric control', () => {
    expect(ControlRequestSchema.safeParse({ speed: '8' }).success).toBe(false);
  });
});
