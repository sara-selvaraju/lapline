import { describe, expect, it } from 'vitest';
import type { SessionRow } from '@lapline/shared';
import { circuitPayload, helloPayload, sessionLabel, statusPayload } from '../src/feed/payloads.js';

const NOW = 1_760_000_000_000;
const session: SessionRow = {
  session_key: 1002,
  session_name: 'Race',
  circuit_short_name: 'Harbourfront',
  country_name: 'Mockland',
  date_start: new Date(NOW - 600_000).toISOString(),
  date_end: new Date(NOW + 3_600_000).toISOString(),
};

const api = { auth: 'none' as const, requests: 8, last: '200 laps' };

describe('statusPayload', () => {
  it('carries the level, text, mode and API counters', () => {
    const out = statusPayload({ level: 'ok', text: 'Replay ready' }, 'replay', api, null);
    expect(out).toEqual({ level: 'ok', text: 'Replay ready', mode: 'replay', api, freshness: null });
  });

  it('includes freeAt only when locked mode set it', () => {
    expect(statusPayload({ level: 'warn', text: 'x' }, 'locked', api, null).freeAt).toBeUndefined();
    const withFree = statusPayload({ level: 'warn', text: 'x', freeAt: '2026-10-11T00:00:00.000Z' }, 'locked', api, null);
    expect(withFree.freeAt).toBe('2026-10-11T00:00:00.000Z');
  });

  it('says only whether credentials exist, never what they are', () => {
    const out = statusPayload({ level: 'ok', text: 'Live' }, 'live', { auth: 'ok' as const, requests: 1, last: null }, null);
    expect(JSON.stringify(out)).not.toMatch(/password|username|secret/i);
    expect(out.api.auth).toBe('ok');
  });
});

describe('circuitPayload', () => {
  const transform = { cx: 0, cy: 0, cz: 0, scale: 1 };

  it('returns the outline once there is one', () => {
    const out = circuitPayload({ points: [[1, 2, 3]], transform, source: 'Sprint', turns: [], sectors: [], marshalSectors: [], pitLane: [], detailSource: 'none' as const }, null);
    expect(out).toEqual({ points: [[1, 2, 3]], transform, source: 'Sprint', turns: [], sectors: [], marshalSectors: [], pitLane: [], detailSource: 'none' as const });
  });

  it('returns a provisional transform with no points', () => {
    expect(circuitPayload(null, transform)).toMatchObject({ points: [], transform, source: 'provisional', detailSource: 'none' });
  });

  it('prefers a real outline over a provisional transform', () => {
    expect(circuitPayload({ points: [[1, 2, 3]], transform, source: 'Sprint', turns: [], sectors: [], marshalSectors: [], pitLane: [], detailSource: 'none' as const }, transform)!.source).toBe('Sprint');
  });

  it('returns null when there is neither', () => {
    expect(circuitPayload(null, null)).toBeNull();
  });
});

describe('sessionLabel', () => {
  it('joins the circuit and a lower-cased session name', () => {
    expect(sessionLabel(session)).toBe('Harbourfront race');
  });

  it('falls back to location when there is no circuit name', () => {
    expect(sessionLabel({ location: 'Monaco', session_name: 'Qualifying' })).toBe('Monaco qualifying');
  });
});

describe('helloPayload', () => {
  const base = {
    session,
    sessStart: NOW - 600_000,
    sessEnd: NOW + 3_600_000,
    mode: 'live' as const,
    userPicked: false,
    drivers: [{ n: 4, code: 'NOR', name: 'A', team: 'X', colour: '#f00' }],
    sessions: [session],
    circuit: null,
    status: statusPayload({ level: 'ok', text: 'Live' }, 'live', api, null),
    canLive: true,
  result: null,
    now: NOW,
  };

  it('summarises the session with epoch times, including an extended end', () => {
    const out = helloPayload(base);
    expect(out.session).toEqual({
      key: 1002,
      name: 'Race',
      circuit: 'Harbourfront',
      country: 'Mockland',
      start: NOW - 600_000,
      end: NOW + 3_600_000,
    });
  });

  it('sends a null session before one is chosen', () => {
    expect(helloPayload({ ...base, session: null }).session).toBeNull();
  });

  it('marks which listed sessions are inside their live window', () => {
    const past: SessionRow = {
      ...session,
      session_key: 1001,
      session_name: 'Sprint',
      date_start: new Date(NOW - 26 * 3_600_000).toISOString(),
      date_end: new Date(NOW - 25 * 3_600_000).toISOString(),
    };
    const out = helloPayload({ ...base, sessions: [session, past] });
    expect(out.sessions.map((s: { key: number; live: boolean }) => [s.key, s.live])).toEqual([
      [1002, true],
      [1001, false],
    ]);
  });

  it('keeps the list start times as ISO strings, unlike the session summary', () => {
    expect(typeof helloPayload(base).sessions[0]!.start).toBe('string');
  });

  it('reports whether live is possible at all', () => {
    expect(helloPayload(base).canLive).toBe(true);
    expect(helloPayload({ ...base, canLive: false }).canLive).toBe(false);
  });
});
