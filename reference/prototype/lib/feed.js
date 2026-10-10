// Feed engine: one shared session, one clock, buffered OpenF1 data, frames out.
//
// Replay: the clock runs over a finished session. Ancillary data (laps, positions,
// intervals, race control, pits, stints) is loaded once. Location and car data are
// fetched in windows just ahead of the clock.
// Live: the clock is "now minus a delay". Data arrives by MQTT when available, with
// REST polling as the fallback whenever MQTT goes quiet.

const { LockedError } = require('./openf1');
const { LiveMqtt } = require('./live-mqtt');

const LIVE_PRE_MS = 30 * 60_000; // OpenF1 treats data as live from 30 min before a session...
const LIVE_POST_MS = 30 * 60_000; // ...until 30 min after it ends.
const HI_KEEP_MS = 90_000; // how much location/car history to keep behind the clock
const ts = (d) => Date.parse(d);
const iso = (ms) => new Date(ms).toISOString();

// Binary search: index of last element with t <= target (elements are arrays with t at [0]).
function lastAtOrBefore(arr, target) {
  let lo = 0;
  let hi = arr.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid][0] <= target) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
}

function insertSorted(arr, row) {
  let i = arr.length;
  while (i > 0 && arr[i - 1][0] > row[0]) i--;
  if (i === arr.length) arr.push(row);
  else arr.splice(i, 0, row);
}

function num(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

class Feed {
  constructor(api, opts = {}) {
    this.api = api;
    this.liveTransport = opts.liveTransport || 'mqtt';
    this.listeners = new Set();
    this.sessions = [];
    this.session = null;
    this.userPicked = false;
    this.mode = 'idle'; // idle | replay | live | locked
    this.status = { level: 'info', text: 'Starting up' };
    this.liveDelayMs = (Number(opts.liveDelayS) || 10) * 1000;
    this.replay = { playing: true, speed: 1, anchorReal: Date.now(), anchorSess: 0 };
    this.lastClients = Date.now();
    this.generation = 0; // bumps on session change so stale async work is discarded
    this.mqtt = null;
    this.resetBuffers();
  }

  // ---------- state ----------

  resetBuffers() {
    this.drivers = new Map();
    this.loc = new Map();
    this.car = new Map();
    this.pos = new Map();
    this.ivl = new Map();
    this.laps = new Map(); // num -> Map(lap_number -> lap)
    this.stints = new Map(); // num -> Map(stint_number -> stint)
    this.pits = new Map();
    this.rc = [];
    this.seen = {
      location: new Set(),
      car_data: new Set(),
      position: new Set(),
      intervals: new Set(),
      race_control: new Set(),
      pit: new Set(),
    };
    this.fetchedUntil = {};
    this.lastFetchAt = {};
    this.track = null; // { points: [[x,y,z]...], transform, source }
    this.provisional = null;
    this.trackAttemptAt = 0;
    this.mqttLastMsg = 0;
  }

  bucket(map, n) {
    let a = map.get(n);
    if (!a) {
      a = [];
      map.set(n, a);
    }
    return a;
  }

  // ---------- ingest (shared by REST and MQTT) ----------

  ingest(topic, rows) {
    if (!this.session) return 0;
    let added = 0;
    for (const r of rows) {
      if (r.session_key !== undefined && r.session_key !== this.session.session_key) continue;
      const n = r.driver_number;
      switch (topic) {
        case 'location': {
          if (!r.date || (r.x === 0 && r.y === 0 && r.z === 0)) break;
          const k = `${n}|${r.date}`;
          if (this.seen.location.has(k)) break;
          this.seen.location.add(k);
          insertSorted(this.bucket(this.loc, n), [ts(r.date), r.x, r.y, r.z]);
          added++;
          break;
        }
        case 'car_data': {
          if (!r.date) break;
          const k = `${n}|${r.date}`;
          if (this.seen.car_data.has(k)) break;
          this.seen.car_data.add(k);
          insertSorted(this.bucket(this.car, n), [ts(r.date), r.speed, r.rpm, r.n_gear, r.throttle, r.brake, r.drs]);
          added++;
          break;
        }
        case 'position': {
          const k = `${n}|${r.date}`;
          if (this.seen.position.has(k)) break;
          this.seen.position.add(k);
          insertSorted(this.bucket(this.pos, n), [ts(r.date), r.position]);
          added++;
          break;
        }
        case 'intervals': {
          const k = `${n}|${r.date}`;
          if (this.seen.intervals.has(k)) break;
          this.seen.intervals.add(k);
          insertSorted(this.bucket(this.ivl, n), [ts(r.date), r.gap_to_leader, r.interval]);
          added++;
          break;
        }
        case 'race_control': {
          const k = `${r.date}|${r.message}`;
          if (this.seen.race_control.has(k)) break;
          this.seen.race_control.add(k);
          insertSorted(this.rc, [ts(r.date), r]);
          added++;
          break;
        }
        case 'pit': {
          const k = `${n}|${r.date}`;
          if (this.seen.pit.has(k)) break;
          this.seen.pit.add(k);
          insertSorted(this.bucket(this.pits, n), [ts(r.date), num(r.lane_duration) ?? num(r.pit_duration) ?? 22]);
          added++;
          break;
        }
        case 'laps': {
          // Laps are updated in place as sectors complete, so upsert by lap number.
          if (n == null || r.lap_number == null) break;
          let m = this.laps.get(n);
          if (!m) this.laps.set(n, (m = new Map()));
          m.set(r.lap_number, {
            n: r.lap_number,
            start: r.date_start ? ts(r.date_start) : null,
            dur: num(r.lap_duration),
            pitOut: Boolean(r.is_pit_out_lap),
          });
          added++;
          break;
        }
        case 'stints': {
          if (n == null || r.stint_number == null) break;
          let m = this.stints.get(n);
          if (!m) this.stints.set(n, (m = new Map()));
          m.set(r.stint_number, {
            compound: r.compound || null,
            start: r.lap_start ?? 1,
            end: r.lap_end ?? null,
            age0: r.tyre_age_at_start ?? 0,
          });
          added++;
          break;
        }
        case 'drivers': {
          if (n == null) break;
          this.drivers.set(n, {
            n,
            code: r.name_acronym || String(n),
            name: r.full_name || r.broadcast_name || String(n),
            team: r.team_name || '',
            colour: r.team_colour ? `#${r.team_colour}` : '#9aa4ae',
          });
          added++;
          break;
        }
        default:
          break;
      }
    }
    return added;
  }

  prune(clockMs) {
    const cutoff = clockMs - HI_KEEP_MS;
    for (const [map, seen] of [
      [this.loc, this.seen.location],
      [this.car, this.seen.car_data],
    ]) {
      for (const arr of map.values()) {
        let i = 0;
        while (i < arr.length && arr[i][0] < cutoff) i++;
        if (i > 0) arr.splice(0, i);
      }
      if (seen.size > 200_000) seen.clear(); // overlap window is short, so a reset only risks a few duplicates
    }
  }

  // ---------- sessions ----------

  isLiveWindow(s, now = Date.now()) {
    const start = ts(s.date_start);
    const end = ts(s.date_end);
    return now >= start - LIVE_PRE_MS && now <= end + LIVE_POST_MS;
  }

  async loadSessionList() {
    const year = new Date().getUTCFullYear();
    let rows = await this.api.get('sessions', [['year', '=', year]]);
    if (!rows.length) rows = await this.api.get('sessions', [['year', '=', year - 1]]);
    const now = Date.now();
    this.sessions = rows
      .filter((s) => !s.is_cancelled && ts(s.date_start) - LIVE_PRE_MS <= now)
      .sort((a, b) => ts(b.date_start) - ts(a.date_start))
      .slice(0, 25);
    return this.sessions;
  }

  pickAutoSession() {
    const now = Date.now();
    return this.sessions.find((s) => this.isLiveWindow(s, now)) || this.sessions[0] || null;
  }

  async boot(initialKey) {
    try {
      await this.loadSessionList();
    } catch (e) {
      this.setStatus('error', `Could not load sessions: ${e.message}`);
    }
    let s = null;
    if (initialKey && initialKey !== 'auto') {
      s = this.sessions.find((x) => String(x.session_key) === String(initialKey));
      if (!s) {
        const rows = await this.api.get('sessions', [['session_key', '=', initialKey]]).catch(() => []);
        s = rows[0] || null;
      }
      if (s) this.userPicked = true;
    }
    if (!s) s = this.pickAutoSession();
    if (s) await this.selectSession(s.session_key, { manual: this.userPicked });
    else this.setStatus('error', 'No sessions found yet.');

    // Every 2 minutes: refresh the list and follow a session that has gone live, unless a session was picked by hand.
    setInterval(async () => {
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
          await this.selectSession(auto.session_key, { manual: false });
        }
      } catch (e) {
        console.error('session refresh', e.message);
      }
    }, 120_000);

    this.loop();
  }

  async selectSession(key, { manual = true, mode } = {}) {
    let s = this.sessions.find((x) => String(x.session_key) === String(key));
    if (!s) {
      const rows = await this.api.get('sessions', [['session_key', '=', key]]);
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
    this.replay = { playing: true, speed: 1, anchorReal: Date.now(), anchorSess: this.sessStart };

    if (live && !this.api.hasCredentials) {
      this.mode = 'locked';
      const free = new Date(this.sessEnd + LIVE_POST_MS);
      this.setStatus('warn', 'Live data needs OpenF1 sponsor credentials', { freeAt: free.toISOString() });
      this.broadcastInit();
      return;
    }

    this.setStatus('info', 'Loading session data');
    this.broadcastInit();
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
        this.setStatus('error', e.message);
      }
    }
    this.broadcastInit();
  }

  // Data loaded once at session start (and refreshed periodically when live).
  async loadStatic(gen) {
    const key = this.session.session_key;
    const sk = ['session_key', '=', key];
    this.ingest('drivers', await this.api.get('drivers', [sk]));
    if (gen !== this.generation) return;
    this.broadcastInit();
    for (const ep of ['laps', 'stints', 'position', 'intervals', 'race_control', 'pit']) {
      const started = Date.now();
      const rows = await this.api.get(ep, [sk]);
      if (gen !== this.generation) return;
      this.ingest(ep, rows);
      this.lastFetchAt[ep] = Date.now();
      this.fetchedUntil[ep] = started;
    }
    if (this.mode === 'replay') {
      // Extend the replay range if the session overran its scheduled end.
      let last = this.sessEnd;
      for (const m of this.laps.values()) for (const l of m.values()) if (l.start) last = Math.max(last, l.start + (l.dur || 0) * 1000);
      this.sessEnd = Math.max(this.sessEnd, last + 120_000);
    }
    await this.ensureTrack(gen);
  }

  // ---------- track ----------

  async ensureTrack(gen) {
    if (this.track || Date.now() - this.trackAttemptAt < 45_000) return;
    this.trackAttemptAt = Date.now();
    const s = this.session;
    const candidates = [s];
    if (this.mode === 'live') {
      // Prefer a finished session from the same weekend: its laps are complete.
      for (const o of this.sessions) {
        if (o.meeting_key === s.meeting_key && o.session_key !== s.session_key && ts(o.date_end) < Date.now()) candidates.unshift(o);
      }
    }
    for (const c of candidates) {
      try {
        const pts = await this.referenceLap(c);
        if (gen !== this.generation) return;
        if (pts && pts.length > 50) {
          this.setTrack(pts, c.session_name);
          return;
        }
      } catch (e) {
        if (e instanceof LockedError) continue;
        console.error('track', e.message);
      }
    }
  }

  async referenceLap(sess) {
    let lapRows;
    if (sess.session_key === this.session.session_key) {
      lapRows = [];
      for (const [n, m] of this.laps) for (const l of m.values()) lapRows.push({ ...l, driver: n });
    } else {
      lapRows = (await this.api.get('laps', [['session_key', '=', sess.session_key]])).map((r) => ({
        driver: r.driver_number,
        n: r.lap_number,
        start: r.date_start ? ts(r.date_start) : null,
        dur: num(r.lap_duration),
        pitOut: Boolean(r.is_pit_out_lap),
      }));
    }
    const valid = lapRows.filter((l) => l.start && l.dur && !l.pitOut && l.n > 1 && l.dur > 40).sort((a, b) => a.dur - b.dur);
    const lap = valid[0];
    if (!lap) return null;
    const rows = await this.api.get('location', [
      ['session_key', '=', sess.session_key],
      ['driver_number', '=', lap.driver],
      ['date', '>=', iso(lap.start - 500)],
      ['date', '<', iso(lap.start + lap.dur * 1000 + 500)],
    ]);
    return rows.filter((r) => !(r.x === 0 && r.y === 0 && r.z === 0)).map((r) => [r.x, r.y, r.z]);
  }

  setTrack(raw, source) {
    // Light smoothing on z, which is noisy at ~4 Hz.
    const n = raw.length;
    const pts = raw.map((p, i) => {
      let zs = 0;
      let c = 0;
      for (let k = -3; k <= 3; k++) {
        const q = raw[(i + k + n) % n];
        zs += q[2];
        c++;
      }
      return [p[0], p[1], Math.round(zs / c)];
    });
    this.track = { points: pts, transform: this.transformFor(pts), source };
    this.broadcast('track', this.trackPayload());
  }

  transformFor(pts) {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity;
    for (const [x, y, z] of pts) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (z < minZ) minZ = z;
    }
    const span = Math.max(maxX - minX, maxY - minY) || 1;
    return { cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, cz: minZ, scale: 100 / span };
  }

  trackPayload() {
    if (this.track) return { points: this.track.points, transform: this.track.transform, source: this.track.source };
    if (this.provisional) return { points: [], transform: this.provisional, source: 'provisional' };
    return null;
  }

  maybeProvisionalTransform() {
    if (this.track || this.provisional) return;
    const pts = [];
    for (const arr of this.loc.values()) for (const r of arr) pts.push([r[1], r[2], r[3]]);
    if (pts.length > 200) {
      this.provisional = this.transformFor(pts);
      this.broadcast('track', this.trackPayload());
    }
  }

  // ---------- clock ----------

  clock() {
    if (this.mode === 'live') return Date.now() - this.liveDelayMs;
    if (this.mode === 'replay') return this.replayNow();
    return this.sessStart || Date.now();
  }

  setReplay({ playing, speed, at }) {
    if (this.mode !== 'replay') return;
    const cur = this.replayNow();
    const r = this.replay;
    r.anchorSess = at != null ? Math.min(Math.max(at, this.sessStart), this.sessEnd) : cur;
    r.anchorReal = Date.now();
    if (playing != null) r.playing = playing;
    if (speed != null) r.speed = Math.min(Math.max(speed, 0.25), 32);
    if (at != null && Math.abs(at - cur) > 5000) {
      // Seek: drop the high-rate buffers and refetch around the new position.
      this.loc = new Map();
      this.car = new Map();
      this.seen.location.clear();
      this.seen.car_data.clear();
      delete this.fetchedUntil.location;
      delete this.fetchedUntil.car_data;
    }
    this.broadcastStatus();
  }

  replayNow() {
    const r = this.replay;
    const t = r.playing ? r.anchorSess + (Date.now() - r.anchorReal) * r.speed : r.anchorSess;
    return Math.min(t, this.sessEnd);
  }

  // ---------- fetch scheduling ----------

  async loop() {
    // Fetch scheduler: runs continuously, one decision per second.
    const tickFetch = async () => {
      try {
        await this.fetchStep();
      } catch (e) {
        if (e instanceof LockedError) {
          this.mode = 'locked';
          this.setStatus('warn', e.message);
          this.broadcastInit();
        } else {
          console.error('fetch', e.message);
          this.setStatus('error', `Fetch problem: ${e.message}`);
        }
      }
      setTimeout(tickFetch, 1000);
    };
    tickFetch();
    // Frames: 4 Hz positions/telemetry, 1 Hz timing.
    let n = 0;
    setInterval(() => {
      if (!this.listeners.size) return;
      const f = this.frame(n % 4 === 0);
      if (f) this.broadcast('tick', f);
      n++;
    }, 250);
    setInterval(() => this.broadcast('ping', { t: Date.now() }), 15_000);
  }

  idle() {
    if (this.listeners.size) {
      this.lastClients = Date.now();
      return false;
    }
    return Date.now() - this.lastClients > 60_000;
  }

  async fetchStep() {
    if (!this.session || (this.mode !== 'replay' && this.mode !== 'live')) return;
    if (this.idle()) return;
    const gen = this.generation;
    const key = this.session.session_key;
    const sk = ['session_key', '=', key];

    if (this.mode === 'replay') {
      const clock = this.replayNow();
      if (this.replay.playing && clock >= this.sessEnd) this.setReplay({ playing: false });
      const windowMs = Math.max(30_000, 20_000 * this.replay.speed);
      for (const ep of ['location', 'car_data']) {
        let from = this.fetchedUntil[ep];
        if (from == null || from < clock - 2000) from = clock - 2000;
        if (from >= clock + windowMs || from >= this.sessEnd) continue;
        const to = Math.min(from + windowMs, this.sessEnd + 1000);
        const rows = await this.api.get(ep, [sk, ['date', '>=', iso(from)], ['date', '<', iso(to)]]);
        if (gen !== this.generation) return;
        this.ingest(ep, rows);
        this.fetchedUntil[ep] = to;
      }
      this.prune(clock);
      this.maybeProvisionalTransform();
      await this.ensureTrack(gen);
      return;
    }

    // Live
    const now = Date.now();
    const mqttHealthy = this.mqtt && now - this.mqttLastMsg < 20_000;
    const plan = [];
    if (!mqttHealthy) {
      plan.push(['location', 4000, 'hi'], ['car_data', 4000, 'hi']);
      plan.push(['position', 15000, 'lo'], ['intervals', 15000, 'lo'], ['race_control', 15000, 'lo'], ['pit', 30000, 'lo']);
      plan.push(['laps', 30000, 'all'], ['stints', 30000, 'all']);
    } else {
      // MQTT carries the stream. A slow REST sweep repairs anything missed.
      plan.push(['laps', 120000, 'all'], ['stints', 120000, 'all']);
    }
    for (const [ep, every, kind] of plan) {
      if (gen !== this.generation) return;
      if (now - (this.lastFetchAt[ep] || 0) < every) continue;
      this.lastFetchAt[ep] = Date.now();
      let filters = [sk];
      if (kind === 'hi' || kind === 'lo') {
        const overlap = kind === 'hi' ? 10_000 : 30_000;
        const firstFrom = kind === 'hi' ? now - 60_000 : this.sessStart - LIVE_PRE_MS;
        const from = this.fetchedUntil[ep] != null ? this.fetchedUntil[ep] - overlap : firstFrom;
        filters = [sk, ['date', '>=', iso(from)]];
      }
      const started = Date.now();
      const rows = await this.api.get(ep, filters);
      if (gen !== this.generation) return;
      this.ingest(ep, rows);
      this.fetchedUntil[ep] = started;
    }
    this.prune(this.clock());
    this.maybeProvisionalTransform();
    await this.ensureTrack(gen);
  }

  // ---------- MQTT ----------

  startMqtt() {
    if (this.liveTransport !== 'mqtt' || !this.api.hasCredentials) return;
    this.mqtt = new LiveMqtt(this.api, (topic, row) => {
      this.mqttLastMsg = Date.now();
      this.ingest(topic, [row]);
    });
    this.mqtt.start().catch((e) => console.error('mqtt', e.message));
  }

  stopMqtt() {
    if (this.mqtt) this.mqtt.stop();
    this.mqtt = null;
  }

  // ---------- frames ----------

  currentLap(n, t) {
    const m = this.laps.get(n);
    if (!m) return { lap: null, last: null, best: null };
    let lap = null;
    let last = null;
    let lastEnd = -Infinity;
    let best = null;
    for (const l of m.values()) {
      if (l.start && l.start <= t && (lap == null || l.n > lap)) lap = l.n;
      if (l.start && l.dur) {
        const end = l.start + l.dur * 1000;
        if (end <= t) {
          if (end > lastEnd) {
            lastEnd = end;
            last = l.dur;
          }
          if (!l.pitOut && (best == null || l.dur < best)) best = l.dur;
        }
      }
    }
    return { lap, last, best };
  }

  tyre(n, lap) {
    const m = this.stints.get(n);
    if (!m || lap == null) return { tyre: null, age: null };
    let found = null;
    for (const s of m.values()) if (s.start <= lap && (s.end == null || lap <= s.end)) found = s;
    if (!found) {
      // Before the stints feed catches up, fall back to the latest stint started.
      for (const s of m.values()) if (s.start <= lap && (!found || s.start > found.start)) found = s;
    }
    if (!found) return { tyre: null, age: null };
    return { tyre: found.compound, age: found.age0 + (lap - found.start) };
  }

  trackFlag(t) {
    let flag = 'GREEN';
    for (const [rt, r] of this.rc) {
      if (rt > t) break;
      const msg = (r.message || '').toUpperCase();
      if (r.category === 'SafetyCar' || msg.includes('SAFETY CAR')) {
        if (msg.includes('VIRTUAL') && msg.includes('DEPLOYED')) flag = 'VSC';
        else if (msg.includes('DEPLOYED')) flag = 'SC';
        else if (msg.includes('ENDING') || msg.includes('IN THIS LAP')) flag = flag === 'VSC' ? 'VSC ENDING' : 'SC ENDING';
        continue;
      }
      if (r.category === 'Flag' && (r.scope === 'Track' || !r.scope)) {
        const f = (r.flag || '').toUpperCase();
        if (f === 'GREEN' || f === 'CLEAR') flag = 'GREEN';
        else if (f === 'RED') flag = 'RED';
        else if (f === 'CHEQUERED') flag = 'CHEQUERED';
        else if (f.includes('YELLOW')) flag = 'YELLOW';
      }
    }
    return flag;
  }

  frame(withTiming) {
    if (!this.session || (this.mode !== 'replay' && this.mode !== 'live')) return null;
    const t = this.mode === 'replay' ? this.replayNow() : this.clock();
    const cars = [];
    for (const [n, arr] of this.loc) {
      const i = lastAtOrBefore(arr, t);
      if (i < 0) continue;
      const a = arr[i];
      const b = arr[i + 1];
      let x = a[1], y = a[2], z = a[3];
      if (b && b[0] - a[0] < 2500) {
        const f = (t - a[0]) / (b[0] - a[0]);
        x += (b[1] - a[1]) * f;
        y += (b[2] - a[2]) * f;
        z += (b[3] - a[3]) * f;
      }
      const stale = t - a[0] > 8000 ? 1 : 0;
      const ca = this.car.get(n);
      const ci = ca ? lastAtOrBefore(ca, t) : -1;
      const c = ci >= 0 ? ca[ci] : null;
      cars.push([n, Math.round(x), Math.round(y), Math.round(z), c ? c[1] : null, c ? c[3] : null, c ? c[2] : null, c ? c[4] : null, c ? c[5] : null, c ? c[6] : null, stale]);
    }
    const out = { t, mode: this.mode, cars };
    if (this.mode === 'replay') out.replay = { playing: this.replay.playing, speed: this.replay.speed, start: this.sessStart, end: this.sessEnd };
    if (this.mode === 'live') out.live = { delayS: this.liveDelayMs / 1000, mqtt: Boolean(this.mqtt && Date.now() - this.mqttLastMsg < 20_000) };

    if (withTiming) {
      const rows = [];
      let leaderLap = null;
      for (const d of this.drivers.values()) {
        const pa = this.pos.get(d.n);
        const pi = pa ? lastAtOrBefore(pa, t) : -1;
        const ia = this.ivl.get(d.n);
        const ii = ia ? lastAtOrBefore(ia, t) : -1;
        const lap = this.currentLap(d.n, t);
        const ty = this.tyre(d.n, lap.lap);
        const pa2 = this.pits.get(d.n);
        let inPit = false;
        if (pa2) for (const [pt, dur] of pa2) if (pt <= t && t <= pt + dur * 1000) inPit = true;
        const p = pi >= 0 ? pa[pi][1] : null;
        if (p === 1) leaderLap = lap.lap;
        rows.push({
          n: d.n,
          p,
          gap: ii >= 0 ? ia[ii][1] : null,
          int: ii >= 0 ? ia[ii][2] : null,
          lap: lap.lap,
          last: lap.last,
          best: lap.best,
          tyre: ty.tyre,
          age: ty.age,
          pit: inPit,
        });
      }
      rows.sort((a, b) => (a.p ?? 99) - (b.p ?? 99));
      const rc = [];
      const k = lastAtOrBefore(this.rc, t);
      for (let j = k; j >= 0 && rc.length < 4; j--) rc.push({ t: this.rc[j][0], msg: this.rc[j][1].message });
      out.timing = { rows, lap: leaderLap, flag: this.trackFlag(t), rc };
    }
    return out;
  }

  // ---------- clients ----------

  setStatus(level, text, extra = {}) {
    this.status = { level, text, ...extra };
    this.broadcastStatus();
  }

  statusPayload() {
    return {
      ...this.status,
      mode: this.mode,
      api: { authed: this.api.hasCredentials, requests: this.api.stats.requests, last: this.api.stats.last },
    };
  }

  broadcastStatus() {
    this.broadcast('status', this.statusPayload());
  }

  initPayload() {
    const s = this.session;
    return {
      session: s
        ? {
            key: s.session_key,
            name: s.session_name,
            circuit: s.circuit_short_name,
            country: s.country_name,
            start: this.sessStart,
            end: this.sessEnd,
          }
        : null,
      mode: this.mode,
      userPicked: this.userPicked,
      drivers: [...this.drivers.values()],
      sessions: this.sessions.map((x) => ({
        key: x.session_key,
        label: `${x.circuit_short_name || x.location} ${(x.session_name || '').toLowerCase()}`,
        start: x.date_start,
        live: this.isLiveWindow(x),
      })),
      track: this.trackPayload(),
      status: this.statusPayload(),
      canLive: this.api.hasCredentials,
    };
  }

  broadcastInit() {
    this.broadcast('init', this.initPayload());
  }

  broadcast(event, data) {
    const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of this.listeners) res.write(msg);
  }

  addListener(res) {
    this.listeners.add(res);
    this.lastClients = Date.now();
    res.write(`event: init\ndata: ${JSON.stringify(this.initPayload())}\n\n`);
  }

  removeListener(res) {
    this.listeners.delete(res);
    this.lastClients = Date.now();
  }
}

module.exports = { Feed, lastAtOrBefore };
