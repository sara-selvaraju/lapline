import { describe, expect, it } from 'vitest';
import type { SessionListEntry } from '@lapline/shared';
import { byWeekend, diagnostics } from '../src/ui/Settings.js';

const entry = (over: Partial<SessionListEntry>): SessionListEntry => ({
  key: 1,
  label: 'Singapore race',
  name: 'Race',
  meeting: 'Singapore',
  meetingKey: 1296,
  start: '2026-10-11T12:00:00+00:00',
  live: false,
  ...over,
});

describe('byWeekend', () => {
  it('keeps a weekend together, in the order it arrived', () => {
    const groups = byWeekend([
      entry({ key: 1, name: 'Race' }),
      entry({ key: 2, name: 'Qualifying' }),
      entry({ key: 3, name: 'Practice 1' }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.sessions.map((s) => s.name)).toEqual(['Race', 'Qualifying', 'Practice 1']);
  });

  it('separates weekends, newest first, since the list already is', () => {
    const groups = byWeekend([
      entry({ key: 1, meeting: 'Singapore', meetingKey: 1296 }),
      entry({ key: 2, meeting: 'Kuala Lumpur', meetingKey: 1295 }),
      entry({ key: 3, meeting: 'Singapore', meetingKey: 1296, name: 'Qualifying' }),
    ]);
    expect(groups.map((g) => g.meeting)).toEqual(['Singapore', 'Kuala Lumpur']);
    expect(groups[0]!.sessions).toHaveLength(2);
  });

  it('falls back to the name when upstream sent no meeting key', () => {
    const groups = byWeekend([
      entry({ key: 1, meetingKey: null, meeting: 'Somewhere' }),
      entry({ key: 2, meetingKey: null, meeting: 'Somewhere' }),
    ]);
    expect(groups).toHaveLength(1);
  });

  it('has nothing to group when there are no sessions', () => {
    expect(byWeekend([])).toEqual([]);
  });
});

describe('the data status line', () => {
  const T = 1_760_000_000_000;
  const status = (over: Partial<{ freshness: number | null; api: { auth: string; requests: number } }> = {}) => ({
    freshness: T - 3000,
    api: { auth: 'ok', requests: 1240 },
    ...over,
  });

  it('reports the lag while live', () => {
    expect(diagnostics(status(), 'live', false, T)).toContain('data 3 s behind real time');
  });

  it('does not claim a lag in a replay, where the figure means nothing', () => {
    // A race from yesterday would otherwise read "data 91560 s behind".
    const line = diagnostics(status({ freshness: T - 91_560_000 }), 'replay', false, T);
    expect(line).toContain('Replaying a finished session');
    expect(line).not.toContain('behind real time');
  });

  it('says so when the stream is interrupted', () => {
    expect(diagnostics(status(), 'live', true, T)).toContain('Stream interrupted');
  });

  it('names the access and the request count', () => {
    expect(diagnostics(status(), 'live', false, T)).toContain('OpenF1 sponsor access, 1,240 requests');
    expect(diagnostics(status({ api: { auth: 'none', requests: 7 } }), 'live', false, T)).toContain(
      'OpenF1 free tier, 7 requests',
    );
    expect(diagnostics(status({ api: { auth: 'rejected', requests: 1 } }), 'live', false, T)).toContain(
      'credentials refused',
    );
  });

  it('waits rather than inventing a number', () => {
    expect(diagnostics(null, 'live')).toBe('Waiting for the server.');
    expect(diagnostics(status({ freshness: null }), 'live', false, T)).toContain('waiting for the first data');
  });
});
