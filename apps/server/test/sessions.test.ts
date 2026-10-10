import { describe, expect, it } from 'vitest';
import type { SessionRow } from '@lapline/shared';
import { filterSessionList, isLiveWindow, pickAutoSession } from '../src/feed/sessions.js';

const MIN = 60_000;
const T = 1_760_000_000_000;

const sess = (key: number, startOffsetMin: number, durMin = 120, extra: Partial<SessionRow> = {}): SessionRow => ({
  session_key: key,
  session_name: `S${key}`,
  date_start: new Date(T + startOffsetMin * MIN).toISOString(),
  date_end: new Date(T + (startOffsetMin + durMin) * MIN).toISOString(),
  is_cancelled: false,
  ...extra,
});

describe('isLiveWindow', () => {
  it('is live from 30 minutes before the start', () => {
    const s = sess(1, 0);
    expect(isLiveWindow(s, T - 31 * MIN)).toBe(false);
    expect(isLiveWindow(s, T - 30 * MIN)).toBe(true);
  });

  it('is live until 30 minutes after the end', () => {
    const s = sess(1, 0, 120);
    expect(isLiveWindow(s, T + 150 * MIN)).toBe(true);
    expect(isLiveWindow(s, T + 151 * MIN)).toBe(false);
  });

  it('is live during the session itself', () => {
    expect(isLiveWindow(sess(1, 0), T + 60 * MIN)).toBe(true);
  });
});

describe('filterSessionList', () => {
  it('hides a session more than 30 minutes from starting', () => {
    const out = filterSessionList([sess(1, -120), sess(2, 600)], T);
    expect(out.map((s) => s.session_key)).toEqual([1]);
  });

  it('includes a session once it is 30 minutes from starting', () => {
    expect(filterSessionList([sess(2, 30)], T).map((s) => s.session_key)).toEqual([2]);
  });

  it('drops cancelled sessions', () => {
    const out = filterSessionList([sess(1, -120), sess(2, -60, 120, { is_cancelled: true })], T);
    expect(out.map((s) => s.session_key)).toEqual([1]);
  });

  it('orders newest first', () => {
    const out = filterSessionList([sess(1, -600), sess(2, -60), sess(3, -300)], T);
    expect(out.map((s) => s.session_key)).toEqual([2, 3, 1]);
  });

  it('caps the list at 25', () => {
    const many = Array.from({ length: 40 }, (_, i) => sess(i, -(i + 1) * 60));
    expect(filterSessionList(many, T)).toHaveLength(25);
  });
});

describe('pickAutoSession', () => {
  it('prefers a session inside its live window', () => {
    const list = filterSessionList([sess(1, -600), sess(2, -10)], T);
    expect(pickAutoSession(list, T)!.session_key).toBe(2);
  });

  it('falls back to the newest when nothing is live', () => {
    const list = filterSessionList([sess(1, -6000), sess(2, -3000)], T);
    expect(pickAutoSession(list, T)!.session_key).toBe(2);
  });

  it('returns null for an empty list', () => {
    expect(pickAutoSession([], T)).toBeNull();
  });
});
