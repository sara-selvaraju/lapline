import { describe, expect, it } from 'vitest';
import type { SessionRow } from '@lapline/shared';
import { filterSessionList, isLiveWindow, pickAutoSession, shouldFollow } from '../src/feed/sessions.js';

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

describe('shouldFollow', () => {
  // Watching session 1, finished two days ago; session 2 is about to start.
  const watching = sess(1, -3000);
  const next = sess(2, 10);

  it('follows a session that has gone live when nothing was picked by hand', () => {
    expect(shouldFollow(watching, next, null, T)).toBe(true);
  });

  it('follows the next live session even after a past one was picked by hand', () => {
    // Picked a replay yesterday: the next session going live still wins.
    expect(shouldFollow(watching, next, T - 1440 * MIN, T)).toBe(true);
  });

  it('keeps a pick made while the live session was already running', () => {
    // Session 2's window opened 20 minutes ago; someone picked a replay since.
    expect(shouldFollow(watching, next, T - 5 * MIN, T)).toBe(false);
  });

  it('never leaves a session pinned with SESSION_KEY', () => {
    expect(shouldFollow(watching, next, Number.POSITIVE_INFINITY, T)).toBe(false);
  });

  it('does not move to a session that is not live', () => {
    expect(shouldFollow(watching, sess(2, 600), null, T)).toBe(false);
  });

  it('does not reselect the session already showing', () => {
    expect(shouldFollow(next, next, null, T)).toBe(false);
  });

  it('does nothing without a current or an auto session', () => {
    expect(shouldFollow(null, next, null, T)).toBe(false);
    expect(shouldFollow(watching, null, null, T)).toBe(false);
  });
});
