// The feed's clock.
//
// Live: now minus a delay the viewer adjusts, so the cars line up with whatever
// the broadcast is showing. Replay: an anchored clock that runs at a chosen speed
// and can be seeked. Both return session time in epoch ms.
//
// Ported from reference/prototype/lib/feed.js.

import type { Mode } from '@lapline/shared';

export interface ReplayState {
  playing: boolean;
  speed: number;
  /** Wall-clock time the anchor was set. */
  anchorReal: number;
  /** Session time at the anchor. */
  anchorSess: number;
}

export interface ReplayBounds {
  sessStart: number;
  sessEnd: number;
}

export interface ReplayPatch {
  playing?: boolean | undefined;
  speed?: number | undefined;
  at?: number | undefined;
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(Math.max(v, lo), hi);

export function newReplayState(sessStart: number, now: number = Date.now()): ReplayState {
  return { playing: true, speed: 1, anchorReal: now, anchorSess: sessStart };
}

/** Session time now, capped at the session end so a finished replay stops there. */
export function replayNow(r: ReplayState, sessEnd: number, now: number = Date.now()): number {
  const t = r.playing ? r.anchorSess + (now - r.anchorReal) * r.speed : r.anchorSess;
  return Math.min(t, sessEnd);
}

/**
 * Applies a replay control, returning the new state and whether this counts as a
 * seek. A seek of more than 5 s means the buffered window is useless, so the
 * caller drops the location and car buffers and refetches around the new
 * position; a smaller jump stays inside what is already buffered.
 *
 * The 5 s test uses the requested time, not the clamped one, as the prototype does.
 */
export function applyReplayControl(
  r: ReplayState,
  patch: ReplayPatch,
  bounds: ReplayBounds,
  now: number = Date.now(),
): { replay: ReplayState; seeked: boolean } {
  const cur = replayNow(r, bounds.sessEnd, now);
  const { playing, speed, at } = patch;
  const next: ReplayState = {
    anchorSess: at != null ? clamp(at, bounds.sessStart, bounds.sessEnd) : cur,
    anchorReal: now,
    playing: playing != null ? playing : r.playing,
    speed: speed != null ? clamp(speed, 0.25, 32) : r.speed,
  };
  return { replay: next, seeked: at != null && Math.abs(at - cur) > 5000 };
}

export interface ClockInput {
  mode: Mode;
  liveDelayMs: number;
  replay: ReplayState;
  sessStart: number | undefined;
  sessEnd: number | undefined;
}

/** Session time the feed is currently showing. */
export function clock(c: ClockInput, now: number = Date.now()): number {
  if (c.mode === 'live') return now - c.liveDelayMs;
  if (c.mode === 'replay') return replayNow(c.replay, c.sessEnd ?? now, now);
  return c.sessStart || now;
}
