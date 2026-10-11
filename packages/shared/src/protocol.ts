// Protocol v1: everything that crosses the SSE boundary.
//
// Both sides validate against these schemas, so the server and the web app
// cannot drift. Clients check `protocolVersion` on `hello` and reload on a
// mismatch, which is how a deploy that changes the wire format recovers without
// anyone clearing a cache.
//
// Changing anything here is a protocol change: bump PROTOCOL_VERSION and say so.

import { z } from 'zod';

/** Bump on any incompatible change to the messages below. */
export const PROTOCOL_VERSION = 2;

export const SSE_EVENTS = ['hello', 'tick', 'timing', 'status', 'circuit', 'ping'] as const;
export type SseEvent = (typeof SSE_EVENTS)[number];

// ---------- shared pieces ----------

export const ModeSchema = z.enum(['idle', 'replay', 'live', 'locked']);
export type Mode = z.infer<typeof ModeSchema>;

export const TrackFlagSchema = z.enum([
  'GREEN',
  'YELLOW',
  'SC',
  'SC ENDING',
  'VSC',
  'VSC ENDING',
  'RED',
  'CHEQUERED',
]);
export type TrackFlag = z.infer<typeof TrackFlagSchema>;

export const StatusLevelSchema = z.enum(['info', 'ok', 'warn', 'error']);
export type StatusLevel = z.infer<typeof StatusLevelSchema>;

export const DriverSchema = z.object({
  n: z.number().int(),
  code: z.string(),
  name: z.string(),
  team: z.string(),
  /** `#rrggbb`, already prefixed. */
  colour: z.string(),
});
export type Driver = z.infer<typeof DriverSchema>;

/** Centre, floor and scale mapping OpenF1's raw coordinates into world units. */
export const TransformSchema = z.object({
  cx: z.number(),
  cy: z.number(),
  cz: z.number(),
  /** 100 world units across the track's longer axis. */
  scale: z.number(),
});
export type Transform = z.infer<typeof TransformSchema>;

export const Point3Schema = z.tuple([z.number(), z.number(), z.number()]);
export type Point3 = z.infer<typeof Point3Schema>;

// ---------- circuit ----------

/**
 * The track outline and how to place it. Turn numbers, sector boundaries,
 * marshal sectors and the pit lane arrive in M3 and will bump the version,
 * because their shapes are not yet known well enough to declare here.
 */
export const CircuitSchema = z.object({
  points: z.array(Point3Schema),
  transform: TransformSchema,
  /** The session the outline came from, or 'provisional'. */
  source: z.string(),
});
export type Circuit = z.infer<typeof CircuitSchema>;

// ---------- hello ----------

export const SessionSummarySchema = z.object({
  key: z.number().int(),
  name: z.string(),
  circuit: z.string(),
  country: z.string(),
  start: z.number(),
  end: z.number(),
});
export type SessionSummary = z.infer<typeof SessionSummarySchema>;

export const SessionListEntrySchema = z.object({
  key: z.number().int(),
  label: z.string(),
  start: z.string(),
  live: z.boolean(),
});
export type SessionListEntry = z.infer<typeof SessionListEntrySchema>;

/**
 * v2 replaced `authed: boolean` with this. A boolean could only say whether
 * credentials were configured, so a rejected credential still reported as
 * authenticated and the UI promised live data it could not deliver.
 */
export const AuthStateSchema = z.enum(['none', 'pending', 'ok', 'rejected']);
export type AuthState = z.infer<typeof AuthStateSchema>;

export const ApiStatsSchema = z.object({
  auth: AuthStateSchema,
  requests: z.number().int(),
  last: z.string().nullable(),
});
export type ApiStats = z.infer<typeof ApiStatsSchema>;

export const StatusSchema = z.object({
  level: StatusLevelSchema,
  text: z.string(),
  /** Locked mode only: when the session becomes free to replay. */
  freeAt: z.string().optional(),
  mode: ModeSchema,
  api: ApiStatsSchema,
  /** Timestamp of the newest upstream row, so the UI can show a stale signal. */
  freshness: z.number().nullable(),
});
export type Status = z.infer<typeof StatusSchema>;

export const HelloSchema = z.object({
  protocolVersion: z.number().int(),
  session: SessionSummarySchema.nullable(),
  mode: ModeSchema,
  userPicked: z.boolean(),
  drivers: z.array(DriverSchema),
  sessions: z.array(SessionListEntrySchema),
  circuit: CircuitSchema.nullable(),
  status: StatusSchema,
  canLive: z.boolean(),
});
export type Hello = z.infer<typeof HelloSchema>;

// ---------- tick ----------

/**
 * One car, as a compact tuple. The order is load-bearing: it is read
 * positionally on both sides, and the server reorders the car-data buffer's
 * speed/rpm/gear into speed/gear/rpm on the way out.
 */
export const CarTupleSchema = z.tuple([
  z.number().int(), // driver number
  z.number(), // x
  z.number(), // y
  z.number(), // z
  z.number().nullable(), // speed, km/h
  z.number().nullable(), // gear, 0 = neutral
  z.number().nullable(), // rpm
  z.number().nullable(), // throttle, 0-100
  z.number().nullable(), // brake, 0 or 100
  z.number().nullable(), // drs, dead from 2026
  z.union([z.literal(0), z.literal(1)]), // stale
]);
export type CarTuple = z.infer<typeof CarTupleSchema>;

export const ReplayMetaSchema = z.object({
  playing: z.boolean(),
  speed: z.number(),
  start: z.number(),
  end: z.number(),
});
export type ReplayMeta = z.infer<typeof ReplayMetaSchema>;

export const LiveMetaSchema = z.object({
  delayS: z.number(),
  /** True while MQTT has delivered a row in the last 20 s. */
  mqtt: z.boolean(),
});
export type LiveMeta = z.infer<typeof LiveMetaSchema>;

/** 4 Hz. Positions and telemetry only; timing is its own event. */
export const TickSchema = z.object({
  t: z.number(),
  mode: ModeSchema,
  cars: z.array(CarTupleSchema),
  replay: ReplayMetaSchema.optional(),
  live: LiveMetaSchema.optional(),
});
export type Tick = z.infer<typeof TickSchema>;

// ---------- timing ----------

export const TowerRowSchema = z.object({
  n: z.number().int(),
  p: z.number().int().nullable(),
  /** Seconds, or upstream text such as '+1 LAP', or null for the leader. */
  gap: z.union([z.number(), z.string()]).nullable(),
  int: z.union([z.number(), z.string()]).nullable(),
  lap: z.number().int().nullable(),
  last: z.number().nullable(),
  best: z.number().nullable(),
  tyre: z.string().nullable(),
  age: z.number().int().nullable(),
  pit: z.boolean(),
});
export type TowerRow = z.infer<typeof TowerRowSchema>;

export const RaceControlLineSchema = z.object({
  t: z.number(),
  msg: z.string(),
});
export type RaceControlLine = z.infer<typeof RaceControlLineSchema>;

/** A marshal sector showing a flag. Populated from M3; empty until then. */
export const MarshalSectorFlagSchema = z.object({
  sector: z.number().int(),
  flag: TrackFlagSchema,
});
export type MarshalSectorFlag = z.infer<typeof MarshalSectorFlagSchema>;

/** 1 Hz. */
export const TimingSchema = z.object({
  t: z.number(),
  rows: z.array(TowerRowSchema),
  /** The leader's lap, or null until some row holds P1. */
  lap: z.number().int().nullable(),
  /** OpenF1 publishes no total-lap figure, so this stays null for now. */
  totalLaps: z.number().int().nullable(),
  flag: TrackFlagSchema,
  marshalSectors: z.array(MarshalSectorFlagSchema),
  /** The four most recent race control messages, newest first. */
  rc: z.array(RaceControlLineSchema),
  /** Driver numbers within 1.0 s of the car ahead, under green. Filled from M4. */
  battles: z.array(z.number().int()),
});
export type Timing = z.infer<typeof TimingSchema>;

// ---------- ping ----------

export const PingSchema = z.object({ t: z.number() });
export type Ping = z.infer<typeof PingSchema>;

// ---------- dispatch ----------

/** Schema per event name, for validating on receipt. */
export const EVENT_SCHEMAS = {
  hello: HelloSchema,
  tick: TickSchema,
  timing: TimingSchema,
  status: StatusSchema,
  circuit: CircuitSchema,
  ping: PingSchema,
} as const satisfies Record<SseEvent, z.ZodType>;

export interface EventPayloads {
  hello: Hello;
  tick: Tick;
  timing: Timing;
  status: Status;
  circuit: Circuit;
  ping: Ping;
}

export function isSseEvent(name: string): name is SseEvent {
  return (SSE_EVENTS as readonly string[]).includes(name);
}
