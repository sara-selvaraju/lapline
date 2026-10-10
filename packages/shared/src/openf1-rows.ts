// Upstream OpenF1 rows, as the prototype reads them.
//
// Every field is optional because the prototype validates nothing: it guards the
// few it must (a location row with no date, or at 0,0,0) and lets the rest fall
// through its own `num()` and `||` defaults. Typing them as present would invite
// guards the prototype does not have, which would be a behaviour change.
// Tolerant zod schemas arrive with protocol v1 in M1.

/** Fields every session-scoped row carries. */
export interface UpstreamRow {
  meeting_key?: number;
  session_key?: number;
  date?: string;
  driver_number?: number;
}

export interface SessionRow {
  session_key?: number;
  session_name?: string;
  session_type?: string;
  date_start?: string;
  date_end?: string;
  meeting_key?: number;
  circuit_key?: number;
  circuit_short_name?: string;
  country_name?: string;
  /** Not in OpenF1's documented fields, but the prototype falls back to it for labels. */
  location?: string;
  year?: number;
  is_cancelled?: boolean;
}

export interface DriverRow extends UpstreamRow {
  name_acronym?: string;
  full_name?: string;
  broadcast_name?: string;
  team_name?: string;
  /** Hex without a leading '#'. */
  team_colour?: string;
}

/** About 3.7 Hz. Origin is arbitrary, units look like decimetres. 0,0,0 means no fix. */
export interface LocationRow extends UpstreamRow {
  x?: number;
  y?: number;
  z?: number;
}

/** About 3.7 Hz. `brake` is 0 or 100 only; `drs` is dead from 2026. */
export interface CarDataRow extends UpstreamRow {
  speed?: number;
  rpm?: number;
  /** 0 is neutral. */
  n_gear?: number;
  throttle?: number;
  brake?: number;
  drs?: number;
}

/** Changes only, not a steady rate. */
export interface PositionRow extends UpstreamRow {
  position?: number;
}

/** Races only, about every 4 s. Null for the leader; text such as '+1 LAP' when lapped. */
export interface IntervalRow extends UpstreamRow {
  gap_to_leader?: number | string | null;
  interval?: number | string | null;
}

/** Updated in place as sectors complete, so upsert by driver and lap number. */
export interface LapRow extends UpstreamRow {
  lap_number?: number;
  /** Approximate, per OpenF1's own notes. */
  date_start?: string;
  lap_duration?: number | null;
  duration_sector_1?: number | null;
  duration_sector_2?: number | null;
  duration_sector_3?: number | null;
  is_pit_out_lap?: boolean;
  i1_speed?: number | null;
  i2_speed?: number | null;
  st_speed?: number | null;
}

export interface StintRow extends UpstreamRow {
  stint_number?: number;
  compound?: string | null;
  lap_start?: number;
  /** Null while the stint is still running. */
  lap_end?: number | null;
  tyre_age_at_start?: number;
}

export interface PitRow extends UpstreamRow {
  lap_number?: number;
  lane_duration?: number | null;
  /** Deprecated, gone after the 2026 season; read only as a fallback. */
  pit_duration?: number | null;
  stop_duration?: number | null;
}

/** Categories include Flag, SafetyCar, SessionStatus and CarEvent. */
export interface RaceControlRow extends UpstreamRow {
  category?: string;
  flag?: string | null;
  scope?: string | null;
  /** The marshal sector, when scope is 'Sector'. */
  sector?: number | null;
  lap_number?: number | null;
  message?: string;
}

export interface MeetingRow {
  meeting_key?: number;
  meeting_name?: string;
  circuit_key?: number;
  /** Feeds the circuit detail in M3; unverified, see docs/OPENF1.md. */
  circuit_info_url?: string;
  gmt_offset?: string;
  date_start?: string;
  date_end?: string;
}

/** Endpoints the feed ingests, keyed as `ingest()` dispatches on them. */
export type IngestTopic =
  | 'location'
  | 'car_data'
  | 'position'
  | 'intervals'
  | 'race_control'
  | 'pit'
  | 'laps'
  | 'stints'
  | 'drivers';
