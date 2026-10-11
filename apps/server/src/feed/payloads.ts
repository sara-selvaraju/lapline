// The protocol v1 messages the feed broadcasts.
//
// Nothing secret goes in here: AGENTS.md forbids echoing env values in
// /api/state or errors, so the API block says only whether credentials exist.

import {
  PROTOCOL_VERSION,
  type ApiStats,
  type Circuit,
  type Driver,
  type Hello,
  type Mode,
  type SessionListEntry,
  type SessionRow,
  type Status,
  type StatusLevel,
  type Transform,
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

export function statusPayload(
  status: FeedStatus,
  mode: Mode,
  api: ApiStats,
  freshness: number | null,
): Status {
  return { ...status, mode, api, freshness };
}

/** The outline, or just a transform while one is still being worked out. */
export function circuitPayload(track: TrackState | null, provisional: Transform | null): Circuit | null {
  if (track) return { points: track.points, transform: track.transform, source: track.source };
  if (provisional) return { points: [], transform: provisional, source: 'provisional' };
  return null;
}

/** 'Harbourfront race', from whichever circuit field upstream filled in. */
export function sessionLabel(s: SessionRow): string {
  return `${s.circuit_short_name || s.location} ${(s.session_name || '').toLowerCase()}`;
}

export interface HelloInput {
  session: SessionRow | null;
  sessStart: number | undefined;
  sessEnd: number | undefined;
  mode: Mode;
  userPicked: boolean;
  drivers: Iterable<Driver>;
  sessions: readonly SessionRow[];
  circuit: Circuit | null;
  status: Status;
  canLive: boolean;
  now?: number;
}

export function helloPayload(i: HelloInput): Hello {
  const s = i.session;
  const now = i.now ?? Date.now();
  const sessions: SessionListEntry[] = i.sessions.map((x) => ({
    key: x.session_key as number,
    label: sessionLabel(x),
    start: x.date_start as string,
    live: isLiveWindow(x, now),
  }));
  return {
    protocolVersion: PROTOCOL_VERSION,
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
    circuit: i.circuit,
    status: i.status,
    canLive: i.canLive,
  };
}
