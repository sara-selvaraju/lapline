// The feed: one shared session, one clock, buffered OpenF1 data, frames out.
//
// Replay: the clock runs over a finished session. Ancillary data loads once;
// location and car data are fetched in windows just ahead of the clock.
// Live: the clock is now minus a delay. Data arrives by MQTT when available,
// with REST polling as the fallback whenever MQTT goes quiet.
//
// Every connected phone shares this one feed, so the OpenF1 rate limit is spent
// once no matter how many viewers there are.
//
// Ported from reference/prototype/lib/feed.js.

import type {
  Circuit,
  LapRow,
  LocationRow,
  Mode,
  SessionResult,
  SessionResultRow,
  SessionRow,
  Tick,
  Timing,
  Transform,
} from '@lapline/shared';
import { LockedError, type OpenF1 } from '../openf1/client.js';
import { LiveMqtt } from '../openf1/live-mqtt.js';
import { createBuffers, num, prune, type Buffers } from './buffers.js';
import { applyReplayControl, clock, newReplayState, replayNow, type ReplayState } from './clock.js';
import { buildTick, buildTiming, trackFlag } from './frames.js';
import { classification } from '../derive/result.js';
import { ingest } from './ingest.js';
import {
  circuitPayload,
  helloPayload,
  statusPayload,
  type FeedStatus,
  type TrackState,
} from './payloads.js';
import {
  isDue,
  liveFetchPlan,
  liveWindowFrom,
  MQTT_QUIET_MS,
  REPLAY_HI_ENDPOINTS,
  replayWindow,
  STATIC_ENDPOINTS,
} from './schedule.js';
import { filterSessionList, isLiveWindow, LIVE_POST_MS, pickAutoSession } from './sessions.js';
import {
  rankedReferenceLaps,
  smoothZ,
  trackCandidates,
  transformFor,
  usableTrace,
  TRACK_RETRY_MS,
  type Point,
} from './track.js';
import { pickPitStops, pitLaneFromTrace, stopWindow, type PitStop } from '../circuit/pitlane.js';
import { fetchCircuitInfo } from '../circuit/multiviewer.js';
import { resolveMarkers, sectorBoundaries, turnsFromOutline, type SectorDurations } from '../circuit/resolve.js';

const ts = (d: string | undefined): number => Date.parse(d as string);
const iso = (ms: number): string => new Date(ms).toISOString();

/** Just enough of an SSE response for the feed to write to. */
export interface FeedListener {
  write(chunk: string): void;
}

export interface FeedOptions {
  liveDelayS?: string | number | undefined;
  liveTransport?: string | undefined;
}

/** Stop fetching once nobody has been connected this long. */
const IDLE_MS = 60_000;
/** How long to wait before another pit-lane attempt. */
const PIT_LANE_RETRY_MS = 60_000;
/** A circuit whose traces do not give a clean lane will not start to. */
const MAX_PIT_LANE_ATTEMPTS = 4;
/** Tries before concluding a session has no position data at all. */
const MAX_EMPTY_TRACK_ATTEMPTS = 3;
/** A session whose result never appears will not start producing one. */
const MAX_RESULT_ATTEMPTS = 4;
const NO_POSITIONS_TEXT =
  'No usable car positions for this session, so the track and cars cannot be drawn.';

export class Feed {
  readonly api: OpenF1;
  readonly liveTransport: string;
  readonly listeners = new Set<FeedListener>();

  sessions: SessionRow[] = [];
  session: SessionRow | null = null;
  userPicked = false;
  mode: Mode = 'idle';
  status: FeedStatus = { level: 'info', text: 'Starting up' };
  liveDelayMs: number;
  replay: ReplayState = newReplayState(Date.now());
  sessStart: number | undefined;
  sessEnd: number | undefined;

  /** Bumps on session change, so stale async work is discarded. */
  private generation = 0;
  private lastClients = Date.now();
  private buffers: Buffers = createBuffers();
  private fetchedUntil: Record<string, number> = {};
  private lastFetchAt: Record<string, number> = {};
  private track: TrackState | null = null;
  private provisional: Transform | null = null;
  private trackAttemptAt = 0;
  /** The final classification, once the session has finished. */
  private result: SessionResult | null = null;
  private resultAttempts = 0;
  /** Attempts where a reference lap existed but had no positions behind it. */
  private trackEmptyAttempts = 0;
  /** Set once we conclude this session simply has no position data. */
  private trackUnavailable = false;
  private pitLaneAttemptAt = 0;
  private pitLaneAttempts = 0;
  private mqttLastMsg = 0;
  private timers: NodeJS.Timeout[] = [];
  private stopped = false;

  constructor(api: OpenF1, opts: FeedOptions = {}) {
    this.api = api;
    this.liveTransport = opts.liveTransport || 'mqtt';
    this.liveDelayMs = (Number(opts.liveDelayS) || 10) * 1000;
  }

  // ---------- state ----------

  private resetBuffers(): void {
    this.buffers = createBuffers();
    this.fetchedUntil = {};
    this.lastFetchAt = {};
    this.track = null;
    this.provisional = null;
    this.trackAttemptAt = 0;
    this.trackEmptyAttempts = 0;
    this.result = null;
    this.resultAttempts = 0;
    this.trackUnavailable = false;
    this.pitLaneAttemptAt = 0;
    this.pitLaneAttempts = 0;
    this.mqttLastMsg = 0;
  }

  /** Shared by REST and MQTT. Rows from another session are dropped. */
  ingest(topic: string, rows: readonly unknown[]): number {
    if (!this.session) return 0;
    return ingest(this.buffers, this.session.session_key as number, topic, rows);
  }

  isLiveWindow(s: SessionRow, now = Date.now()): boolean {
    return isLiveWindow(s, now);
  }

  // ---------- sessions ----------

  async loadSessionList(): Promise<SessionRow[]> {
    const year = new Date().getUTCFullYear();
    let rows = await this.api.get<SessionRow>('sessions', [['year', '=', year]]);
    // Early in January the current year is empty, so fall back to the last one.
    if (!rows.length) rows = await this.api.get<SessionRow>('sessions', [['year', '=', year - 1]]);
    this.sessions = filterSessionList(rows);
    return this.sessions;
  }

  pickAutoSession(): SessionRow | null {
    return pickAutoSession(this.sessions);
  }

  async boot(initialKey: string | undefined): Promise<void> {
    try {
      await this.loadSessionList();
    } catch (e) {
      this.setStatus('error', `Could not load sessions: ${message(e)}`);
    }

    let s: SessionRow | null = null;
    if (initialKey && initialKey !== 'auto') {
      s = this.sessions.find((x) => String(x.session_key) === String(initialKey)) ?? null;
      if (!s) {
        const rows = await this.api
          .get<SessionRow>('sessions', [['session_key', '=', initialKey]])
          .catch(() => [] as SessionRow[]);
        s = rows[0] ?? null;
      }
      if (s) this.userPicked = true;
    }
    if (!s) s = this.pickAutoSession();
    if (s) await this.selectSession(s.session_key as number, { manual: this.userPicked });
    else this.setStatus('error', 'No sessions found yet.');

    // Every 2 minutes: refresh the list, and follow a session that has gone live
    // unless one was picked by hand.
    this.timers.push(
      setInterval(() => {
        void (async () => {
          try {
            await this.loadSessionList();
            const auto = this.pickAutoSession();
            if (
              !this.userPicked &&
              auto &&
              this.session &&
              auto.session_key !== this.session.session_key &&
              this.isLiveWindow(auto)
            ) {
              await this.selectSession(auto.session_key as number, { manual: false });
            }
          } catch (e) {
            console.error('session refresh', message(e));
          }
        })();
      }, 120_000),
    );

    this.loop();
  }

  async selectSession(
    key: number | string,
    { manual = true, mode }: { manual?: boolean; mode?: Mode | undefined } = {},
  ): Promise<void> {
    let s = this.sessions.find((x) => String(x.session_key) === String(key));
    if (!s) {
      const rows = await this.api.get<SessionRow>('sessions', [['session_key', '=', key]]);
      s = rows[0];
    }
    if (!s) throw new Error(`Unknown session ${key}`);

    this.generation++;
    const gen = this.generation;
    this.userPicked = manual;
    this.stopMqtt();
    this.session = s;
    this.resetBuffers();

    const live = this.isLiveWindow(s);
    this.mode = mode || (live ? 'live' : 'replay');
    this.sessStart = ts(s.date_start);
    this.sessEnd = ts(s.date_end);
    this.replay = newReplayState(this.sessStart);

    // Inside the live window with no credentials, there is nothing to fetch.
    if (live && !this.api.hasCredentials) {
      this.mode = 'locked';
      const free = new Date(this.sessEnd + LIVE_POST_MS);
      this.setStatus('warn', 'Live data needs OpenF1 sponsor credentials', { freeAt: free.toISOString() });
      this.broadcastHello();
      return;
    }

    this.setStatus('info', 'Loading session data');
    this.broadcastHello();
    try {
      await this.loadStatic(gen);
      if (gen !== this.generation) return;
      if (this.mode === 'live') this.startMqtt();
      this.setReadyStatus();
    } catch (e) {
      if (gen !== this.generation) return;
      if (e instanceof LockedError) {
        this.mode = 'locked';
        this.setStatus('warn', e.message);
      } else {
        this.setStatus('error', message(e));
      }
    }
    this.broadcastHello();
  }

  /** Data loaded once at session start, and refreshed periodically when live. */
  private async loadStatic(gen: number): Promise<void> {
    const key = this.session!.session_key as number;
    this.ingest('drivers', await this.api.get('drivers', [['session_key', '=', key]]));
    if (gen !== this.generation) return;
    // Drivers alone are worth sending: the tower can render before timing lands.
    this.broadcastHello();

    for (const ep of STATIC_ENDPOINTS) {
      const started = Date.now();
      const rows = await this.api.get(ep, [['session_key', '=', key]]);
      if (gen !== this.generation) return;
      this.ingest(ep, rows);
      this.lastFetchAt[ep] = Date.now();
      this.fetchedUntil[ep] = started;
    }

    if (this.mode === 'replay') {
      // Extend the replay range if the session overran its scheduled end.
      let last = this.sessEnd as number;
      for (const m of this.buffers.laps.values()) {
        for (const l of m.values()) if (l.start) last = Math.max(last, l.start + (l.dur || 0) * 1000);
      }
      this.sessEnd = Math.max(this.sessEnd as number, last + 120_000);
    }

    await this.ensureTrack(gen);
  }

  // ---------- track ----------

  private async ensureTrack(gen: number): Promise<void> {
    if (this.track || this.trackUnavailable) return;
    if (Date.now() - this.trackAttemptAt < TRACK_RETRY_MS) return;
    this.trackAttemptAt = Date.now();

    // Laps with no usable positions behind them is the signal that upstream
    // cannot give us an outline, as opposed to not having a finished lap yet.
    // Two 2026 sessions are like this: Monaco 404s on location throughout, and
    // Hungary serves rows whose positions repeat 26 values around the lap.
    let sawEmptyLap = false;
    for (const c of trackCandidates(this.session!, this.sessions, this.mode)) {
      try {
        const ref = await this.referenceLap(c);
        if (gen !== this.generation) return;
        if (ref && ref.points.length > 0) {
          this.trackEmptyAttempts = 0;
          this.setTrack(ref.points, c.session_name as string, ref.sectors);
          return;
        }
        // Laps existed, but none of them had positions we could use.
        if (ref) sawEmptyLap = true;
      } catch (e) {
        // A locked candidate is expected on the free tier; try the next one.
        if (e instanceof LockedError) continue;
        console.error('track', message(e));
      }
    }

    if (!sawEmptyLap) return;
    // Several attempts apart, all finding laps but no positions. Stop asking,
    // and say so: the tower and the telemetry still work, so this is a
    // degraded session rather than a broken one.
    // A replay's data is already complete, so one pass over the best laps
    // settles it and the viewer is told straight away. A live session might
    // simply not have published positions yet, so there we keep trying for a
    // couple of minutes before saying anything.
    const limit = this.mode === 'live' ? MAX_EMPTY_TRACK_ATTEMPTS : 1;
    if (++this.trackEmptyAttempts >= limit) {
      this.trackUnavailable = true;
      this.setStatus('warn', NO_POSITIONS_TEXT);
    }
  }

  private async referenceLap(
    sess: SessionRow,
  ): Promise<{ points: Point[]; sectors: SectorDurations | null } | null> {
    let lapRows;
    if (sess.session_key === this.session!.session_key) {
      // Already buffered, so this costs no request.
      lapRows = [];
      for (const [n, m] of this.buffers.laps) for (const l of m.values()) lapRows.push({ ...l, driver: n });
    } else {
      lapRows = (await this.api.get<LapRow>('laps', [['session_key', '=', sess.session_key as number]])).map(
        (r) => {
          const s1 = num(r.duration_sector_1);
          const s2 = num(r.duration_sector_2);
          const s3 = num(r.duration_sector_3);
          return {
            driver: r.driver_number as number,
            n: r.lap_number as number,
            start: r.date_start ? ts(r.date_start) : null,
            dur: num(r.lap_duration),
            pitOut: Boolean(r.is_pit_out_lap),
            sectors: s1 != null && s2 != null && s3 != null ? { s1, s2, s3 } : null,
          };
        },
      );
    }
    // Fastest first, but a lap whose positions are unusable is skipped rather
    // than accepted: everything else is placed against this trace, so a bad
    // one puts every corner, sector and pit lane slightly wrong instead of
    // failing visibly.
    const candidates = rankedReferenceLaps(lapRows);
    if (candidates.length === 0) return null;
    for (const lap of candidates) {
      const start = lap.start as number;
      const dur = lap.dur as number;
      const rows = await this.api.get<LocationRow>('location', [
        ['session_key', '=', sess.session_key as number],
        ['driver_number', '=', lap.driver],
        ['date', '>=', iso(start - 500)],
        ['date', '<', iso(start + dur * 1000 + 500)],
      ]);
      const points = rows
        .filter((r) => !(r.x === 0 && r.y === 0 && r.z === 0))
        .map((r) => [r.x as number, r.y as number, r.z as number] as Point);
      const verdict = usableTrace(points);
      if (verdict.ok) {
        return { points, sectors: (lap as { sectors?: SectorDurations | null }).sectors ?? null };
      }
      console.error(
        `track: ${sess.session_name} lap ${lap.n} for ${lap.driver} unusable, ${verdict.reason}`,
      );
    }
    return { points: [], sectors: null };
  }

  private setTrack(raw: Point[], source: string, durations: SectorDurations | null): void {
    const points = smoothZ(raw);
    this.track = {
      points,
      transform: transformFor(points),
      source,
      turns: [],
      sectors: sectorBoundaries(points.length, durations),
      marshalSectors: [],
      pitLane: [],
      detailSource: 'none',
    };
    this.broadcast('circuit', this.circuitPayload());
    // The circuit file is a third party, so the outline goes out first and the
    // detail follows if and when it arrives.
    void this.addCircuitDetail(this.generation);
  }

  /**
   * Corner and marshal-sector positions, from the meeting's circuit file where
   * there is one and from the lap's own shape where there is not. Never blocks
   * the outline, and never fails the session: a circuit with no detail is a
   * circuit, and a missing third party is not our viewer's problem.
   */
  private async addCircuitDetail(gen: number): Promise<void> {
    const track = this.track;
    if (!track || !this.session) return;

    let url: string | undefined;
    try {
      const rows = await this.api.get<{ circuit_info_url?: string }>('meetings', [
        ['meeting_key', '=', this.session.meeting_key as number],
      ]);
      url = rows[0]?.circuit_info_url;
    } catch (e) {
      console.error('meetings', message(e));
    }
    if (gen !== this.generation || this.track !== track) return;

    const info = await fetchCircuitInfo(url);
    if (gen !== this.generation || this.track !== track) return;

    if (info && info.corners.length > 0) {
      track.turns = resolveMarkers(track.points, info.corners);
      track.marshalSectors = resolveMarkers(track.points, info.marshalSectors);
      track.detailSource = 'circuit-file';
    } else {
      track.turns = turnsFromOutline(track.points);
      track.detailSource = track.turns.length > 0 ? 'curvature' : 'none';
    }
    this.broadcast('circuit', this.circuitPayload());
  }

  /**
   * The pit lane, traced from a car that has served a stop.
   *
   * This cannot run with the outline, because at the start of a race nobody
   * has pitted yet. It is retried while the layer is empty, but only once
   * there is a stop worth tracing, so a session with no stops yet costs
   * nothing. A few attempts is the limit: a circuit where the trace does not
   * give a clean lane will not start giving one.
   */
  private async ensurePitLane(gen: number): Promise<void> {
    const track = this.track;
    if (!track || track.pitLane.length > 0) return;
    if (this.pitLaneAttempts >= MAX_PIT_LANE_ATTEMPTS) return;
    if (Date.now() - this.pitLaneAttemptAt < PIT_LANE_RETRY_MS) return;

    const stops: PitStop[] = [];
    for (const [driver, rows] of this.buffers.pits) {
      for (const [at, durationS] of rows) stops.push({ driver, at, laneDurationS: durationS });
    }
    const candidates = pickPitStops(stops);
    if (candidates.length === 0) return;

    this.pitLaneAttemptAt = Date.now();
    this.pitLaneAttempts++;
    const stop = candidates[0]!;
    const { from, to } = stopWindow(stop);
    try {
      const rows = await this.api.get<LocationRow>('location', [
        ['session_key', '=', this.session!.session_key as number],
        ['driver_number', '=', stop.driver],
        ['date', '>=', iso(from)],
        ['date', '<', iso(to)],
      ]);
      if (gen !== this.generation || this.track !== track) return;
      const trace = rows
        .filter((r) => !(r.x === 0 && r.y === 0 && r.z === 0))
        .sort((a, b) => ts(a.date as string) - ts(b.date as string))
        .map((r) => [r.x as number, r.y as number, r.z as number] as Point);
      const lane = pitLaneFromTrace(track.points, trace);
      if (lane.length === 0) return;
      track.pitLane = lane;
      this.broadcast('circuit', this.circuitPayload());
    } catch (e) {
      if (!(e instanceof LockedError)) console.error('pit lane', message(e));
    }
  }

  /**
   * The final classification, fetched once the chequered flag has fallen.
   *
   * Asked for only when the session is actually over, because upstream has
   * nothing to say before then, and only a few times, so a session whose
   * result never appears does not cost a request a minute for ever. It goes
   * out on hello rather than on every timing frame: twenty-odd rows that will
   * never change again have no business being repeated once a second.
   */
  private async ensureResult(gen: number): Promise<void> {
    if (this.result || !this.session) return;
    if (this.resultAttempts >= MAX_RESULT_ATTEMPTS) return;
    if (trackFlag(this.buffers, this.clock()) !== 'CHEQUERED') return;

    this.resultAttempts++;
    try {
      const rows = await this.api.get<SessionResultRow>('session_result', [
        ['session_key', '=', this.session.session_key as number],
      ]);
      if (gen !== this.generation) return;
      if (rows.length === 0) return;
      this.result = classification(rows, this.buffers, this.clock());
      // Hello is how the result reaches anyone already watching.
      this.broadcastHello();
    } catch (e) {
      if (!(e instanceof LockedError)) console.error('session result', message(e));
    }
  }

  /** The buffers, for the read-only queries in http/query.ts. */
  buffersRef(): Buffers {
    return this.buffers;
  }

  /** The outline, or an empty list before one is built. */
  trackPoints(): ReadonlyArray<readonly [number, number, number]> {
    return this.track?.points ?? [];
  }

  /** Whether any car has a position sample at or before `t`. */
  private hasPositionsAt(t: number): boolean {
    for (const rows of this.buffers.loc.values()) {
      if (rows.length > 0 && rows[0]![0] <= t) return true;
    }
    return false;
  }

  circuitPayload(): Circuit | null {
    return circuitPayload(this.track, this.provisional);
  }

  /** A rough transform from whatever positions we have, so the view can orient. */
  private maybeProvisionalTransform(): void {
    if (this.track || this.provisional) return;
    const pts: Point[] = [];
    for (const arr of this.buffers.loc.values()) for (const r of arr) pts.push([r[1], r[2], r[3]]);
    if (pts.length > 200) {
      this.provisional = transformFor(pts);
      this.broadcast('circuit', this.circuitPayload());
    }
  }

  // ---------- clock ----------

  clock(): number {
    return clock({
      mode: this.mode,
      liveDelayMs: this.liveDelayMs,
      replay: this.replay,
      sessStart: this.sessStart,
      sessEnd: this.sessEnd,
    });
  }

  replayNow(): number {
    return replayNow(this.replay, this.sessEnd ?? Date.now());
  }

  setReplay(patch: { playing?: boolean | undefined; speed?: number | undefined; at?: number | undefined }): void {
    if (this.mode !== 'replay') return;
    const { replay, seeked } = applyReplayControl(this.replay, patch, {
      sessStart: this.sessStart as number,
      sessEnd: this.sessEnd as number,
    });
    this.replay = replay;
    // A small jump normally stays inside what is already buffered — but not
    // if the buffer was refilled by an earlier seek and so begins at that
    // point with nothing behind it. Dragging the scrubber a little to the
    // left then lands before any data at all and every car disappears. So the
    // test is what we actually hold, not only how far the clock moved.
    if (seeked || !this.hasPositionsAt(replayNow(replay, this.sessEnd as number))) {
      // The buffered window is useless now; drop it and refetch around the new spot.
      this.buffers.loc = new Map();
      this.buffers.car = new Map();
      this.buffers.seen.location.clear();
      this.buffers.seen.car_data.clear();
      delete this.fetchedUntil.location;
      delete this.fetchedUntil.car_data;
    }
    this.broadcastStatus();
  }

  // ---------- fetch scheduling ----------

  private loop(): void {
    // One fetch decision per second, chained so a slow request cannot overlap itself.
    const tickFetch = async (): Promise<void> => {
      try {
        await this.fetchStep();
      } catch (e) {
        if (e instanceof LockedError) {
          this.mode = 'locked';
          this.setStatus('warn', e.message);
          this.broadcastHello();
        } else {
          console.error('fetch', message(e));
          this.setStatus('error', `Fetch problem: ${message(e)}`);
        }
      }
      if (!this.stopped) this.timers.push(setTimeout(() => void tickFetch(), 1000));
    };
    void tickFetch();

    // Protocol v1 splits these: 4 Hz positions and telemetry, 1 Hz timing.
    this.timers.push(
      setInterval(() => {
        if (!this.listeners.size) return;
        const f = this.tick();
        if (f) this.broadcast('tick', f);
      }, 250),
    );
    this.timers.push(
      setInterval(() => {
        if (!this.listeners.size) return;
        const f = this.timing();
        if (f) this.broadcast('timing', f);
      }, 1000),
    );
    this.timers.push(setInterval(() => this.broadcast('ping', { t: Date.now() }), 15_000));
  }

  /** Clears the timers. Used by tests; production runs until the process exits. */
  stop(): void {
    this.stopped = true;
    for (const t of this.timers) {
      clearTimeout(t);
      clearInterval(t);
    }
    this.timers = [];
    this.stopMqtt();
  }

  /** True once nobody has been connected for a minute, which pauses fetching. */
  idle(): boolean {
    if (this.listeners.size) {
      this.lastClients = Date.now();
      return false;
    }
    return Date.now() - this.lastClients > IDLE_MS;
  }

  async fetchStep(): Promise<void> {
    if (!this.session || (this.mode !== 'replay' && this.mode !== 'live')) return;
    if (this.idle()) return;

    // A session that has left its live window is finished, and live fetching
    // will only ask OpenF1 for data that will never arrive. The periodic
    // refresh cannot catch this: it only switches when auto-pick lands on a
    // *different* session, and the one that just ended is still the newest.
    if (this.mode === 'live' && !this.isLiveWindow(this.session)) {
      this.setStatus('info', 'The session has finished. Loading the replay.');
      await this.selectSession(this.session.session_key as number, {
        manual: this.userPicked,
        mode: 'replay',
      });
      return;
    }

    const gen = this.generation;
    const key = this.session.session_key as number;

    if (this.mode === 'replay') {
      const clockMs = this.replayNow();
      if (this.replay.playing && clockMs >= (this.sessEnd as number)) this.setReplay({ playing: false });
      for (const ep of REPLAY_HI_ENDPOINTS) {
        const w = replayWindow(this.fetchedUntil[ep], clockMs, this.replay.speed, this.sessEnd as number);
        if (!w) continue;
        const rows = await this.api.get(ep, [
          ['session_key', '=', key],
          ['date', '>=', iso(w.from)],
          ['date', '<', iso(w.to)],
        ]);
        if (gen !== this.generation) return;
        this.ingest(ep, rows);
        this.fetchedUntil[ep] = w.to;
      }
      prune(this.buffers, clockMs);
      this.maybeProvisionalTransform();
      await this.ensureTrack(gen);
      await this.ensurePitLane(gen);
      await this.ensureResult(gen);
      return;
    }

    // Live
    const now = Date.now();
    const mqttHealthy = Boolean(this.mqtt) && now - this.mqttLastMsg < MQTT_QUIET_MS;
    for (const [ep, every, kind] of liveFetchPlan(mqttHealthy)) {
      if (gen !== this.generation) return;
      if (!isDue(this.lastFetchAt[ep], every, now)) continue;
      this.lastFetchAt[ep] = Date.now();
      const from = liveWindowFrom(kind, this.fetchedUntil[ep], now, this.sessStart as number);
      const filters: Parameters<OpenF1['get']>[1] = [['session_key', '=', key]];
      if (from != null) filters.push(['date', '>=', iso(from)]);
      const started = Date.now();
      const rows = await this.api.get(ep, filters);
      if (gen !== this.generation) return;
      this.ingest(ep, rows);
      this.fetchedUntil[ep] = started;
    }
    prune(this.buffers, this.clock());
    this.maybeProvisionalTransform();
    await this.ensureTrack(gen);
    await this.ensurePitLane(gen);
    await this.ensureResult(gen);
  }

  // ---------- MQTT ----------

  private mqtt: LiveMqtt | null = null;

  /**
   * Only when MQTT is the chosen transport and credentials exist. With
   * LIVE_TRANSPORT=rest this stays null, so mqttHealthy is never true and the
   * fetch scheduler runs the full REST plan.
   */
  private startMqtt(): void {
    if (this.liveTransport !== 'mqtt' || !this.api.hasCredentials) return;
    this.mqtt = new LiveMqtt(this.api, (topic, row) => {
      this.mqttLastMsg = Date.now();
      this.ingest(topic, [row]);
    });
    void this.mqtt.start().catch((e: unknown) => console.error('mqtt', message(e)));
  }

  private stopMqtt(): void {
    if (this.mqtt) this.mqtt.stop();
    this.mqtt = null;
  }

  // ---------- frames ----------

  /** Session time the frames are sampled at. */
  private frameTime(): number {
    return this.mode === 'replay' ? this.replayNow() : this.clock();
  }

  private streaming(): boolean {
    return Boolean(this.session) && (this.mode === 'replay' || this.mode === 'live');
  }

  tick(): Tick | null {
    if (!this.streaming()) return null;
    return buildTick(this.buffers, {
      mode: this.mode,
      t: this.frameTime(),
      replay:
        this.mode === 'replay'
          ? {
              playing: this.replay.playing,
              speed: this.replay.speed,
              start: this.sessStart as number,
              end: this.sessEnd as number,
            }
          : undefined,
      live:
        this.mode === 'live'
          ? {
              delayS: this.liveDelayMs / 1000,
              mqtt: Boolean(this.mqtt) && Date.now() - this.mqttLastMsg < MQTT_QUIET_MS,
            }
          : undefined,
    });
  }

  timing(): Timing | null {
    if (!this.streaming()) return null;
    return buildTiming(this.buffers, this.frameTime());
  }

  // ---------- clients ----------

  /**
   * "Live" or "Replay ready", unless we already know this session has no
   * track to draw. Selecting a session says it is ready, and that generic
   * line must not paper over the more specific warning a failed outline
   * already published for the very same session.
   */
  private setReadyStatus(): void {
    if (this.trackUnavailable) this.setStatus('warn', NO_POSITIONS_TEXT);
    else this.setStatus('ok', this.mode === 'live' ? 'Live' : 'Replay ready');
  }

  setStatus(level: FeedStatus['level'], text: string, extra: { freeAt?: string } = {}): void {
    this.status = { level, text, ...extra };
    this.broadcastStatus();
  }

  statusPayload() {
    return statusPayload(
      this.status,
      this.mode,
      {
        auth: this.api.authState,
        requests: this.api.stats.requests,
        last: this.api.stats.last,
      },
      this.buffers.newest,
    );
  }

  broadcastStatus(): void {
    this.broadcast('status', this.statusPayload());
  }

  helloPayload() {
    return helloPayload({
      session: this.session,
      sessStart: this.sessStart,
      sessEnd: this.sessEnd,
      mode: this.mode,
      userPicked: this.userPicked,
      drivers: this.buffers.drivers.values(),
      sessions: this.sessions,
      circuit: this.circuitPayload(),
      status: this.statusPayload(),
      canLive: this.canLive(),
      result: this.result,
    });
  }

  /** Live is possible only when authentication is working, or not yet tried. */
  canLive(): boolean {
    return this.api.authState === 'ok' || this.api.authState === 'pending';
  }

  broadcastHello(): void {
    this.broadcast('hello', this.helloPayload());
  }

  broadcast(event: string, data: unknown): void {
    const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of this.listeners) res.write(msg);
  }

  addListener(res: FeedListener): void {
    this.listeners.add(res);
    this.lastClients = Date.now();
    res.write(`event: hello\ndata: ${JSON.stringify(this.helloPayload())}\n\n`);
  }

  removeListener(res: FeedListener): void {
    this.listeners.delete(res);
    this.lastClients = Date.now();
  }
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
