// The payloads sent to browsers.
//
// Ported from reference/prototype/lib/feed.js. Nothing secret goes in here:
// AGENTS.md forbids echoing env values in /api/state or errors, so the API block
// says only whether credentials exist, never what they are.

import type {
  ApiStats,
  Driver,
  InitPayload,
  Mode,
  SessionListEntry,
  SessionRow,
  StatusLevel,
  StatusPayload,
  TrackPayload,
  Transform,
} from '@lapline/shared';
import { isLiveWindow } from './sessions.js';
import type { Point } from './track.js';

export interface FeedStatus {
  level: StatusLevel;
  text: string;
  freeAt?: string | undefined;
}

export interface TrackState {
  points: Point[];
  transform: Transform;
  source: string;
}

export function statusPayload(status: FeedStatus, mode: Mode, api: ApiStats): StatusPayload {
  return { ...status, mode, api };
}

/** The outline, or just a transform while one is still being worked out. */
export function trackPayload(
  track: TrackState | null,
  provisional: Transform | null,
): TrackPayload | null {
  if (track) return { points: track.points, transform: track.transform, source: track.source };
  if (provisional) return { points: [], transform: provisional, source: 'provisional' };
  return null;
}

/** 'Harbourfront race', from whichever circuit field upstream filled in. */
export function sessionLabel(s: SessionRow): string {
  return `${s.circuit_short_name || s.location} ${(s.session_name || '').toLowerCase()}`;
}

export interface InitInput {
  session: SessionRow | null;
  sessStart: number | undefined;
  sessEnd: number | undefined;
  mode: Mode;
  userPicked: boolean;
  drivers: Iterable<Driver>;
  sessions: readonly SessionRow[];
  track: TrackPayload | null;
  status: StatusPayload;
  canLive: boolean;
  now?: number;
}

export function initPayload(i: InitInput): InitPayload {
  const s = i.session;
  const now = i.now ?? Date.now();
  const sessions: SessionListEntry[] = i.sessions.map((x) => ({
    key: x.session_key as number,
    label: sessionLabel(x),
    start: x.date_start as string,
    live: isLiveWindow(x, now),
  }));
  return {
    session: s
      ? {
          key: s.session_key as number,
          name: s.session_name as string,
          circuit: s.circuit_short_name as string,
          country: s.country_name as string,
          start: i.sessStart as number,
          end: i.sessEnd as number,
        }
      : null,
    mode: i.mode,
    userPicked: i.userPicked,
    drivers: [...i.drivers],
    sessions,
    track: i.track,
    status: i.status,
    canLive: i.canLive,
  };
}
