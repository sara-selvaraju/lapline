// Mock OpenF1 for development when no session is on (or for offline testing).
// Simulates a synthetic street circuit with 20 fictional drivers and two sessions:
// a finished "Sprint" (free to read) and a "Race" running now (needs a token, like the real live window).
// Run: node mock/mock-openf1.js   then   OPENF1_BASE=http://localhost:4001 node server.js
const http = require('http');

const PORT = Number(process.env.MOCK_PORT) || 4001;
const NOW0 = Date.now();
const LAPS = 30;

// ---- track ----
const N = 1200;
const R = 6000;
const P = [];
for (let i = 0; i < N; i++) {
  const th = (i / N) * Math.PI * 2;
  const r = R * (1 + 0.22 * Math.sin(2 * th) + 0.12 * Math.cos(3 * th) + 0.07 * Math.sin(5 * th + 0.4));
  P.push([Math.round(r * Math.cos(th) * 1.25), Math.round(r * Math.sin(th)), Math.round(40 + 28 * Math.sin(2 * th + 1) + 10 * Math.sin(7 * th))]);
}
const seg = [];
for (let i = 0; i < N; i++) {
  const a = P[i], b = P[(i + 1) % N], c = P[(i + 2) % N];
  const ds = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const h1 = Math.atan2(b[1] - a[1], b[0] - a[0]);
  const h2 = Math.atan2(c[1] - b[1], c[0] - b[0]);
  let dh = Math.abs(h2 - h1);
  if (dh > Math.PI) dh = 2 * Math.PI - dh;
  seg.push({ ds, k: dh / Math.max(ds, 1) });
}
let v = seg.map((s) => 25 + 63 * Math.exp(-s.k * 2500)); // m/s
for (let pass = 0; pass < 6; pass++) v = v.map((_, i) => (v[(i - 2 + N) % N] + v[(i - 1 + N) % N] + v[i] + v[(i + 1) % N] + v[(i + 2) % N]) / 5);
const cum = [0];
for (let i = 0; i < N; i++) cum.push(cum[i] + seg[i].ds / (v[i] * 10));
const T0 = cum[N];

const DRIVERS = [
  ['AVA', 'Ava ARDEN', 'Northline', 'E8702A'], ['BEN', 'Ben OKAFOR', 'Northline', 'E8702A'],
  ['CRU', 'Cruz VALE', 'Kestrel', '3671C6'], ['DEL', 'Dell MORROW', 'Kestrel', '3671C6'],
  ['EMI', 'Emi SATO', 'Ardent', 'E80020'], ['FIN', 'Finn HALE', 'Ardent', 'E80020'],
  ['GIO', 'Gio RAMOS', 'Verdant', '27F4D2'], ['HUX', 'Hux PALMER', 'Verdant', '27F4D2'],
  ['ISL', 'Isla REYES', 'Sable', '229971'], ['JUN', 'Jun TAKEDA', 'Sable', '229971'],
  ['KAI', 'Kai MBEKI', 'Lumen', 'FF87BC'], ['LEO', 'Leo FAURE', 'Lumen', 'FF87BC'],
  ['MAR', 'Mara COLE', 'Tidal', '64C4FF'], ['NOA', 'Noa BRANDT', 'Tidal', '64C4FF'],
  ['ORI', 'Ori LANG', 'Cinder', 'B6BABD'], ['PIP', 'Pip ADEYEMI', 'Cinder', 'B6BABD'],
  ['QUI', 'Quinn ROSS', 'Halcyon', '52E252'], ['RAF', 'Raf SILVA', 'Halcyon', '52E252'],
  ['SOL', 'Sol IVERS', 'Meridian', '6692FF'], ['TAM', 'Tam NGUYEN', 'Meridian', '6692FF'],
].map(([code, name, team, col], i) => ({ n: i + 2, code, name, team, col, f: 1 + 0.0035 * i + 0.002 * Math.sin(i * 7.1) }));

const SESSIONS = [
  { session_key: 1001, session_name: 'Sprint', session_type: 'Race', start: NOW0 - 26 * 3600_000, laps: 12 },
  { session_key: 1002, session_name: 'Race', session_type: 'Race', start: NOW0 - 3 * 60_000, laps: LAPS },
].map((s) => ({
  ...s,
  end: s.start + Math.max(45 * 60_000, s.laps * T0 * 1000 * 1.15),
  meeting_key: 9001,
  circuit_key: 99,
  circuit_short_name: 'Harbourfront',
  country_name: 'Mockland',
  location: 'Harbourfront',
  year: new Date().getUTCFullYear(),
}));

const iso = (ms) => new Date(ms).toISOString().replace('Z', '+00:00');

// progress in laps for driver d at time t
function progress(s, d, t) {
  const tau = (t - s.start) / 1000 - (d.n - 2) * 0.3;
  if (tau < 0) return 0;
  return Math.min(tau / (T0 * d.f), s.laps);
}
function where(p) {
  const frac = p - Math.floor(p);
  const target = frac * T0;
  let lo = 0, hi = N;
  while (lo < hi - 1) {
    const m = (lo + hi) >> 1;
    if (cum[m] <= target) lo = m;
    else hi = m;
  }
  const f = (target - cum[lo]) / (cum[lo + 1] - cum[lo]);
  const a = P[lo], b = P[(lo + 1) % N];
  return { i: lo, x: a[0] + (b[0] - a[0]) * f, y: a[1] + (b[1] - a[1]) * f, z: a[2] + (b[2] - a[2]) * f };
}
function pitLap(d) {
  return 6 + (d.n % 5);
}

function rowsFor(ep, s, from, to) {
  const out = [];
  const lim = Math.min(to, s.end, Date.now() - 2000);
  const base = { meeting_key: s.meeting_key, session_key: s.session_key };
  if (ep === 'location' || ep === 'car_data') {
    const step = 270;
    const j0 = Math.max(0, Math.ceil((from - s.start) / step));
    for (let j = j0; s.start + j * step < lim; j++) {
      for (const d of DRIVERS) {
        const t = s.start + j * step + d.n * 7;
        if (t < from || t >= lim) continue;
        const p = progress(s, d, t);
        const w = where(p);
        if (ep === 'location') out.push({ ...base, date: iso(t), driver_number: d.n, x: Math.round(w.x), y: Math.round(w.y), z: Math.round(w.z) });
        else {
          const moving = p > 0 && p < s.laps;
          const kmh = moving ? Math.round((v[w.i] / d.f) * 3.6) : 0;
          const dv = v[(w.i + 6) % N] - v[w.i];
          const brake = moving && dv < -1.5 ? 100 : 0;
          const thr = !moving ? 0 : brake ? 0 : Math.max(20, Math.min(100, Math.round(70 + dv * 15)));
          out.push({ ...base, date: iso(t), driver_number: d.n, speed: kmh, n_gear: moving ? Math.max(1, Math.min(8, Math.round(kmh / 42) + 1)) : 0, rpm: moving ? Math.round(8200 + ((kmh % 42) / 42) * 3300) : 4000, throttle: thr, brake, drs: 0 });
        }
      }
    }
    return out;
  }
  if (ep === 'position' || ep === 'intervals') {
    const step = 4000;
    const j0 = Math.max(0, Math.ceil((from - s.start) / step));
    for (let j = j0; s.start + j * step < lim; j++) {
      const t = s.start + j * step;
      if (t < from) continue;
      const pr = DRIVERS.map((d) => ({ d, p: progress(s, d, t) })).sort((a, b) => b.p - a.p || a.d.n - b.d.n);
      pr.forEach((e, idx) => {
        if (ep === 'position') out.push({ ...base, date: iso(t + 5), driver_number: e.d.n, position: idx + 1 });
        else {
          const lead = pr[0].p;
          const ahead = idx ? pr[idx - 1].p : null;
          const gapL = (lead - e.p) * T0 * e.d.f;
          const gapA = ahead == null ? null : (ahead - e.p) * T0 * e.d.f;
          out.push({ ...base, date: iso(t + 10), driver_number: e.d.n, gap_to_leader: idx === 0 ? null : lead - e.p >= 1 ? '+1 LAP' : +gapL.toFixed(3), interval: idx === 0 ? null : +gapA.toFixed(3) });
        }
      });
    }
    return out;
  }
  if (ep === 'laps') {
    for (const d of DRIVERS) {
      for (let lap = 1; lap <= s.laps; lap++) {
        const st = s.start + ((d.n - 2) * 0.3 + (lap - 1) * T0 * d.f) * 1000;
        if (st > lim) break;
        const dur = T0 * d.f;
        const done = st + dur * 1000 <= lim;
        out.push({ ...base, driver_number: d.n, lap_number: lap, date_start: iso(st), lap_duration: done ? +(dur + (lap === 1 ? 4 : 0)).toFixed(3) : null, is_pit_out_lap: lap === pitLap(d) + 1 });
      }
    }
    return out;
  }
  if (ep === 'stints') {
    for (const d of DRIVERS) {
      out.push({ ...base, driver_number: d.n, stint_number: 1, compound: d.n % 3 ? 'MEDIUM' : 'SOFT', lap_start: 1, lap_end: pitLap(d), tyre_age_at_start: d.n % 3 ? 0 : 3 });
      out.push({ ...base, driver_number: d.n, stint_number: 2, compound: 'HARD', lap_start: pitLap(d) + 1, lap_end: null, tyre_age_at_start: 0 });
    }
    return out;
  }
  if (ep === 'pit') {
    for (const d of DRIVERS) {
      const t = s.start + ((d.n - 2) * 0.3 + pitLap(d) * T0 * d.f) * 1000 - 8000;
      if (t <= lim) out.push({ ...base, driver_number: d.n, date: iso(t), lap_number: pitLap(d), lane_duration: 21.8, pit_duration: 21.8, stop_duration: 2.3 });
    }
    return out;
  }
  if (ep === 'race_control') {
    const ev = [
      [0, 'Flag', 'GREEN', 'Track', 'GREEN LIGHT - PIT EXIT OPEN'],
      [5 * 60_000, 'Flag', 'YELLOW', 'Sector', 'YELLOW IN TRACK SECTOR 7'],
      [6 * 60_000, 'Flag', 'CLEAR', 'Sector', 'CLEAR IN TRACK SECTOR 7'],
      [9 * 60_000, 'SafetyCar', null, 'Track', 'SAFETY CAR DEPLOYED'],
      [11 * 60_000, 'SafetyCar', null, 'Track', 'SAFETY CAR IN THIS LAP'],
      [12 * 60_000, 'Flag', 'GREEN', 'Track', 'TRACK CLEAR'],
      [s.laps * T0 * 1000, 'Flag', 'CHEQUERED', 'Track', 'CHEQUERED FLAG'],
    ];
    for (const [dt, category, flag, scope, message] of ev) {
      const t = s.start + dt;
      if (t <= lim) out.push({ ...base, date: iso(t), category, flag, scope, message, driver_number: null, lap_number: null, sector: null });
    }
    return out;
  }
  if (ep === 'drivers') {
    return DRIVERS.map((d) => ({ ...base, driver_number: d.n, name_acronym: d.code, full_name: d.name, broadcast_name: d.name.toUpperCase(), team_name: d.team, team_colour: d.col }));
  }
  return out;
}

function parseFilters(qs) {
  const f = [];
  for (const part of qs.split('&').filter(Boolean)) {
    const dec = decodeURIComponent(part.replace(/\+/g, ' '));
    const m = dec.match(/^([a-z_0-9]+)(>=|<=|>|<|=)(.*)$/);
    if (m) f.push([m[1], m[2], m[3]]);
  }
  return f;
}
function cmp(a, op, b) {
  switch (op) {
    case '=': return a === b;
    case '>': return a > b;
    case '>=': return a >= b;
    case '<': return a < b;
    case '<=': return a <= b;
  }
  return false;
}
function matches(row, [k, op, raw]) {
  const v = row[k];
  if (v === undefined) return true;
  if (typeof v === 'number') return cmp(v, op, Number(raw));
  if (typeof v === 'boolean') return cmp(String(v), op, raw);
  if (typeof v === 'string' && /^\d{4}-\d\d-\d\d/.test(v) && !Number.isNaN(Date.parse(raw))) return cmp(Date.parse(v), op, Date.parse(raw));
  return cmp(String(v), op, raw);
}

const TOKEN = 'mock-token';
const isLive = (s) => Date.now() >= s.start - 30 * 60_000 && Date.now() <= s.end + 30 * 60_000;

http
  .createServer((req, res) => {
    const [pathname, qs = ''] = req.url.split('?');
    const send = (code, body) => {
      res.writeHead(code, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (pathname === '/token' && req.method === 'POST') return send(200, { access_token: TOKEN, expires_in: '3600', token_type: 'bearer' });
    const m = pathname.match(/^\/v1\/([a-z_]+)$/);
    if (!m) return send(404, { detail: 'Not found' });
    const ep = m[1];
    const filters = parseFilters(qs);
    const authed = req.headers.authorization === `Bearer ${TOKEN}`;

    if (ep === 'sessions') {
      const rows = SESSIONS.map((s) => ({ ...s, date_start: iso(s.start), date_end: iso(s.end), gmt_offset: '08:00:00', is_cancelled: false })).map(({ start, end, laps, ...r }) => r);
      const out = rows.filter((r) => filters.every((f) => matches(r, f)));
      return out.length ? send(200, out) : send(404, { detail: 'No results found.' });
    }
    const sk = filters.find((f) => f[0] === 'session_key');
    const s = SESSIONS.find((x) => sk && String(x.session_key) === sk[2]);
    if (!s) return send(404, { detail: 'No results found.' });
    if (isLive(s) && !authed) return send(401, { detail: 'Authentication required for live data' });
    let from = s.start - 60_000;
    let to = s.end + 60_000;
    for (const [k, op, raw] of filters) {
      if (k !== 'date') continue;
      if (op === '>' || op === '>=') from = Math.max(from, Date.parse(raw));
      if (op === '<' || op === '<=') to = Math.min(to, Date.parse(raw) + (op === '<=' ? 1 : 0));
    }
    const rows = rowsFor(ep, s, from, to).filter((r) => filters.every((f) => matches(r, f)));
    console.log(`${req.method} ${ep} ${rows.length} rows ${authed ? '(auth)' : ''}`);
    return rows.length ? send(200, rows) : send(404, { detail: 'No results found.' });
  })
  .listen(PORT, () => console.log(`mock OpenF1 on :${PORT}, lap time ${T0.toFixed(1)} s`));
