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

import type { Circuit, LapRow, LocationRow, Mode, SessionRow, Tick, Timing, Transform } from '@lapline/shared';
import { LockedError, type OpenF1 } from '../openf1/client.js';
import { LiveMqtt } from '../openf1/live-mqtt.js';
import { createBuffers, num, prune, type Buffers } from './buffers.js';
import { applyReplayControl, clock, newReplayState, replayNow, type ReplayState } from './clock.js';
import { buildTick, buildTiming } from './frames.js';
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
import { pickReferenceLap, smoothZ, trackCandidates, transformFor, TRACK_RETRY_MS, type Point } from './track.js';

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
      this.setStatus('ok', this.mode === 'live' ? 'Live' : 'Replay ready');
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
    if (this.track || Date.now() - this.trackAttemptAt < TRACK_RETRY_MS) return;
    this.trackAttemptAt = Date.now();
    for (const c of trackCandidates(this.session!, this.sessions, this.mode)) {
      try {
        const pts = await this.referenceLap(c);
        if (gen !== this.generation) return;
        if (pts && pts.length > 50) {
          this.setTrack(pts, c.session_name as string);
          return;
        }
      } catch (e) {
        // A locked candidate is expected on the free tier; try the next one.
        if (e instanceof LockedError) continue;
        console.error('track', message(e));
      }
    }
  }

  private async referenceLap(sess: SessionRow): Promise<Point[] | null> {
    let lapRows;
    if (sess.session_key === this.session!.session_key) {
      // Already buffered, so this costs no request.
      lapRows = [];
      for (const [n, m] of this.buffers.laps) for (const l of m.values()) lapRows.push({ ...l, driver: n });
    } else {
      lapRows = (await this.api.get<LapRow>('laps', [['session_key', '=', sess.session_key as number]])).map(
        (r) => ({
          driver: r.driver_number as number,
          n: r.lap_number as number,
          start: r.date_start ? ts(r.date_start) : null,
          dur: num(r.lap_duration),
          pitOut: Boolean(r.is_pit_out_lap),
        }),
      );
    }
    const lap = pickReferenceLap(lapRows);
    if (!lap) return null;
    const start = lap.start as number;
    const dur = lap.dur as number;
    const rows = await this.api.get<LocationRow>('location', [
      ['session_key', '=', sess.session_key as number],
      ['driver_number', '=', lap.driver],
      ['date', '>=', iso(start - 500)],
      ['date', '<', iso(start + dur * 1000 + 500)],
    ]);
    return rows
      .filter((r) => !(r.x === 0 && r.y === 0 && r.z === 0))
      .map((r) => [r.x as number, r.y as number, r.z as number] as Point);
  }

  private setTrack(raw: Point[], source: string): void {
    const points = smoothZ(raw);
    this.track = { points, transform: transformFor(points), source };
    this.broadcast('circuit', this.circuitPayload());
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
    if (seeked) {
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
