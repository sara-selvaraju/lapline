// The prototype's SSE wire shapes, as types.
//
// M0 is a port, so these describe exactly what reference/prototype/lib/feed.js
// already sends and reference/prototype/public/app.js already reads. Protocol v1
// (separate `tick` and `timing` events, zod schemas, a version check) is M1;
// nothing here is redesigned.

/** Which data path the feed is on. `idle` before a session is chosen. */
export type Mode = 'idle' | 'replay' | 'live' | 'locked';

/** Track flag, as derived from race control. `trackFlag()` returns these strings. */
export type TrackFlag =
  | 'GREEN'
  | 'YELLOW'
  | 'SC'
  | 'SC ENDING'
  | 'VSC'
  | 'VSC ENDING'
  | 'RED'
  | 'CHEQUERED';

export type StatusLevel = 'info' | 'ok' | 'warn' | 'error';

export interface Driver {
  n: number;
  code: string;
  name: string;
  team: string;
  /** `#rrggbb`, already prefixed; falls back to the haze token when upstream has none. */
  colour: string;
}

/** Centre, floor and scale that map OpenF1's raw coordinates into world units. */
export interface Transform {
  cx: number;
  cy: number;
  cz: number;
  /** 100 world units across the track's longer axis. */
  scale: number;
}

export interface TrackPayload {
  /** The reference lap's position trace, z lightly smoothed. Empty when provisional. */
  points: Array<[x: number, y: number, z: number]>;
  transform: Transform;
  /** The session name the outline came from, or 'provisional'. */
  source: string;
}

export interface SessionSummary {
  key: number;
  name: string;
  circuit: string;
  country: string;
  /** Epoch ms. `end` is extended past the scheduled end when a replay overran. */
  start: number;
  end: number;
}

export interface SessionListEntry {
  key: number;
  label: string;
  /** ISO 8601, straight from upstream, unlike SessionSummary's epoch ms. */
  start: string;
  live: boolean;
}

export interface ApiStats {
  authed: boolean;
  requests: number;
  /** `"<status> <endpoint>"` for the most recent request, or null before the first. */
  last: string | null;
}

export interface StatusPayload {
  level: StatusLevel;
  text: string;
  /** ISO 8601, only in locked mode: when the session becomes free to replay. */
  freeAt?: string;
  mode: Mode;
  api: ApiStats;
}

export interface InitPayload {
  session: SessionSummary | null;
  mode: Mode;
  userPicked: boolean;
  drivers: Driver[];
  sessions: SessionListEntry[];
  track: TrackPayload | null;
  status: StatusPayload;
  canLive: boolean;
}

/**
 * One car in a tick, as a compact tuple. The order is load-bearing: the web
 * destructures it positionally, and frames.ts reorders the car-data buffer's
 * speed, rpm and gear into speed, gear, rpm here.
 */
export type CarTuple = [
  n: number,
  x: number,
  y: number,
  z: number,
  speed: number | null,
  gear: number | null,
  rpm: number | null,
  throttle: number | null,
  brake: number | null,
  /** Replaced by active aero in 2026; carried on the wire, never shown. */
  drs: number | null,
  stale: 0 | 1,
];

export interface TowerRow {
  n: number;
  /** Position, or null before the position feed has a row for this driver. */
  p: number | null;
  /** Gap to the leader: seconds, or text such as '+1 LAP', or null for the leader. */
  gap: number | string | null;
  /** Interval to the car ahead, same shape as `gap`. */
  int: number | string | null;
  lap: number | null;
  last: number | null;
  best: number | null;
  tyre: string | null;
  age: number | null;
  pit: boolean;
}

export interface RaceControlLine {
  t: number;
  msg: string | undefined;
}

export interface TimingBlock {
  rows: TowerRow[];
  /** The leader's lap, or null until some row holds P1. */
  lap: number | null;
  flag: TrackFlag;
  /** The four most recent messages at or before the clock, newest first. */
  rc: RaceControlLine[];
}

export interface ReplayMeta {
  playing: boolean;
  speed: number;
  start: number;
  end: number;
}

export interface LiveMeta {
  delayS: number;
  /** True while MQTT has delivered a row in the last 20 s. */
  mqtt: boolean;
}

export interface Tick {
  /** Session time the frame was sampled at, epoch ms. */
  t: number;
  mode: Mode;
  cars: CarTuple[];
  replay?: ReplayMeta;
  live?: LiveMeta;
  /** Present on every fourth tick, so timing arrives at 1 Hz. */
  timing?: TimingBlock;
}

export interface Ping {
  t: number;
}
