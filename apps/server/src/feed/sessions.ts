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
