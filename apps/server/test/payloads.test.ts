import { describe, expect, it } from 'vitest';
import type { SessionRow } from '@lapline/shared';
import { initPayload, sessionLabel, statusPayload, trackPayload } from '../src/feed/payloads.js';

const NOW = 1_760_000_000_000;
const session: SessionRow = {
  session_key: 1002,
  session_name: 'Race',
  circuit_short_name: 'Harbourfront',
  country_name: 'Mockland',
  date_start: new Date(NOW - 600_000).toISOString(),
  date_end: new Date(NOW + 3_600_000).toISOString(),
};

const api = { authed: false, requests: 8, last: '200 laps' };

describe('statusPayload', () => {
  it('carries the level, text, mode and API counters', () => {
    const out = statusPayload({ level: 'ok', text: 'Replay ready' }, 'replay', api);
    expect(out).toEqual({ level: 'ok', text: 'Replay ready', mode: 'replay', api });
  });

  it('includes freeAt only when locked mode set it', () => {
    expect(statusPayload({ level: 'warn', text: 'x' }, 'locked', api).freeAt).toBeUndefined();
    const withFree = statusPayload({ level: 'warn', text: 'x', freeAt: '2026-10-11T00:00:00.000Z' }, 'locked', api);
    expect(withFree.freeAt).toBe('2026-10-11T00:00:00.000Z');
  });

  it('says only whether credentials exist, never what they are', () => {
    const out = statusPayload({ level: 'ok', text: 'Live' }, 'live', { authed: true, requests: 1, last: null });
    expect(JSON.stringify(out)).not.toMatch(/password|username|secret/i);
    expect(out.api.authed).toBe(true);
  });
});

describe('trackPayload', () => {
  const transform = { cx: 0, cy: 0, cz: 0, scale: 1 };

  it('returns the outline once there is one', () => {
    const out = trackPayload({ points: [[1, 2, 3]], transform, source: 'Sprint' }, null);
    expect(out).toEqual({ points: [[1, 2, 3]], transform, source: 'Sprint' });
  });

  it('returns a provisional transform with no points', () => {
    expect(trackPayload(null, transform)).toEqual({ points: [], transform, source: 'provisional' });
  });

  it('prefers a real outline over a provisional transform', () => {
    expect(trackPayload({ points: [[1, 2, 3]], transform, source: 'Sprint' }, transform)!.source).toBe('Sprint');
  });

  it('returns null when there is neither', () => {
    expect(trackPayload(null, null)).toBeNull();
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

describe('initPayload', () => {
  const base = {
    session,
    sessStart: NOW - 600_000,
    sessEnd: NOW + 3_600_000,
    mode: 'live' as const,
    userPicked: false,
    drivers: [{ n: 4, code: 'NOR', name: 'A', team: 'X', colour: '#f00' }],
    sessions: [session],
    track: null,
    status: statusPayload({ level: 'ok', text: 'Live' }, 'live', api),
    canLive: true,
    now: NOW,
  };

  it('summarises the session with epoch times, including an extended end', () => {
    const out = initPayload(base);
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
    expect(initPayload({ ...base, session: null }).session).toBeNull();
  });

  it('marks which listed sessions are inside their live window', () => {
    const past: SessionRow = {
      ...session,
      session_key: 1001,
      session_name: 'Sprint',
      date_start: new Date(NOW - 26 * 3_600_000).toISOString(),
      date_end: new Date(NOW - 25 * 3_600_000).toISOString(),
    };
    const out = initPayload({ ...base, sessions: [session, past] });
    expect(out.sessions.map((s) => [s.key, s.live])).toEqual([
      [1002, true],
      [1001, false],
    ]);
  });

  it('keeps the list start times as ISO strings, unlike the session summary', () => {
    expect(typeof initPayload(base).sessions[0]!.start).toBe('string');
  });

  it('reports whether live is possible at all', () => {
    expect(initPayload(base).canLive).toBe(true);
    expect(initPayload({ ...base, canLive: false }).canLive).toBe(false);
  });
});
