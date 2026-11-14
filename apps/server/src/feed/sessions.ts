// Choosing a session.
//
// OpenF1 treats data as live from 30 minutes before a session starts until 30
// minutes after it ends. Inside that window the free tier is refused, which is
// what puts the feed into locked mode.
//
// Ported from reference/prototype/lib/feed.js.

import type { SessionRow } from '@lapline/shared';

export const LIVE_PRE_MS = 30 * 60_000;
export const LIVE_POST_MS = 30 * 60_000;

const ts = (d: string | undefined): number => Date.parse(d as string);

export function isLiveWindow(s: SessionRow, now: number = Date.now()): boolean {
  const start = ts(s.date_start);
  const end = ts(s.date_end);
  return now >= start - LIVE_PRE_MS && now <= end + LIVE_POST_MS;
}

/**
 * The sessions worth offering: not cancelled, already inside their live window or
 * past, newest first, capped at 25. Sessions refresh daily at midnight UTC, so a
 * weekend's are listed before they start — hence the start-time filter.
 */
export function filterSessionList(rows: readonly SessionRow[], now: number = Date.now()): SessionRow[] {
  return rows
    .filter((s) => !s.is_cancelled && ts(s.date_start) - LIVE_PRE_MS <= now)
    .sort((a, b) => ts(b.date_start) - ts(a.date_start))
    .slice(0, 25);
}

/** Whichever session is live, else the most recent one. */
export function pickAutoSession(
  sessions: readonly SessionRow[],
  now: number = Date.now(),
): SessionRow | null {
  return sessions.find((s) => isLiveWindow(s, now)) || sessions[0] || null;
}

/**
 * Whether the feed should move to the auto-picked session on its own.
 *
 * The feed is shared, so a pick by hand holds for every viewer, but only until
 * the next session goes live. A pick is a choice about what to watch now, not
 * a standing order: someone replaying a past race on Wednesday should not keep
 * every phone off Friday's practice. So a pick holds against any session that
 * was already live when it was made, and gives way to one whose live window
 * opens after it. `pickedAt` is null when nothing was picked by hand, and
 * Infinity for a session pinned with SESSION_KEY, which never gives way.
 */
export function shouldFollow(
  current: SessionRow | null,
  auto: SessionRow | null,
  pickedAt: number | null,
  now: number = Date.now(),
): boolean {
  if (!auto || !current || auto.session_key === current.session_key) return false;
  if (!isLiveWindow(auto, now)) return false;
  return pickedAt === null || ts(auto.date_start) - LIVE_PRE_MS > pickedAt;
}
