import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const $ = (id) => document.getElementById(id);
const COLORS = { flood: 0xf2ebdd, night: 0x0e1626, line: 0x283857, haze: 0x8c9ab5 };
const TYRE_LETTER = { SOFT: 'S', MEDIUM: 'M', HARD: 'H', INTERMEDIATE: 'I', WET: 'W' };
const FRAME_MS = 250;

const prefs = loadPrefs();
const state = {
  session: null,
  mode: 'idle',
  drivers: new Map(),
  sessions: [],
  track: null,
  transform: null,
  sel: prefs.sel ?? null,
  gapMode: prefs.gapMode || 'int',
  zx: prefs.zx ?? 4,
  allLabels: prefs.allLabels ?? false,
  follow: false,
  timing: null,
  timingByN: new Map(),
  lastTick: null,
  history: [],
  replay: null,
  live: null,
  status: null,
  canLive: false,
  scrubbing: false,
};

function loadPrefs() {
  try {
    return JSON.parse(localStorage.getItem('lapline') || '{}');
  } catch {
    return {};
  }
}
function savePrefs() {
  try {
    localStorage.setItem(
      'lapline',
      JSON.stringify({ sel: state.sel, gapMode: state.gapMode, zx: state.zx, allLabels: state.allLabels })
    );
  } catch {}
}

// ---------------- three.js scene ----------------

const canvas = $('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setClearColor(COLORS.night);
const scene = new THREE.Scene();
scene.fog = new THREE.Fog(COLORS.night, 230, 440);
const camera = new THREE.PerspectiveCamera(45, 1, 0.5, 1000);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.12;
controls.maxPolarAngle = Math.PI * 0.47;
controls.minDistance = 6;
controls.maxDistance = 320;
controls.screenSpacePanning = false;

const grid = new THREE.PolarGridHelper(70, 12, 6, 64, COLORS.line, COLORS.line);
grid.material.transparent = true;
grid.material.opacity = 0.35;
scene.add(grid);

const trackGroup = new THREE.Group();
scene.add(trackGroup);
const carGroup = new THREE.Group();
scene.add(carGroup);
const cars = new Map(); // n -> { mesh, hit, label, halo, from, to, t0, shown }

// Fit the 100-unit-wide track into whichever of the two view angles is narrower.
function resetView() {
  const vfov = THREE.MathUtils.degToRad(camera.fov);
  const hfov = 2 * Math.atan(Math.tan(vfov / 2) * camera.aspect);
  const dist = (54 / Math.tan(Math.min(vfov, hfov) / 2)) * 1.05;
  const dir = new THREE.Vector3(0, 0.82, 0.57).normalize();
  camera.position.copy(dir.multiplyScalar(dist));
  controls.target.set(0, 0, 0);
  controls.update();
}

let viewFitted = false;
function resize() {
  const r = canvas.parentElement.getBoundingClientRect();
  renderer.setSize(r.width, r.height, false);
  camera.aspect = r.width / Math.max(r.height, 1);
  camera.updateProjectionMatrix();
  if (!viewFitted && r.width > 0) {
    resetView();
    viewFitted = true;
  }
}
new ResizeObserver(resize).observe(canvas.parentElement);
resize();

function toWorld(x, y, z, out = new THREE.Vector3()) {
  const t = state.transform;
  if (!t) return out.set(0, 0, 0);
  return out.set((x - t.cx) * t.scale, Math.max(0, (z - t.cz) * t.scale * state.zx), -(y - t.cy) * t.scale);
}

function buildTrack() {
  trackGroup.clear();
  const pts = state.track?.points || [];
  if (pts.length < 10) return;
  const P = pts.map((p) => toWorld(p[0], p[1], p[2]));
  const n = P.length;
  const halfW = 0.55;
  const ribbon = new Float32Array(n * 2 * 3);
  const curtain = new Float32Array(n * 2 * 3);
  const tmp = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    const a = P[(i - 1 + n) % n];
    const b = P[(i + 1) % n];
    tmp.subVectors(b, a).setY(0).normalize();
    const nx = -tmp.z;
    const nz = tmp.x;
    const p = P[i];
    ribbon.set([p.x + nx * halfW, p.y + 0.02, p.z + nz * halfW, p.x - nx * halfW, p.y + 0.02, p.z - nz * halfW], i * 6);
    curtain.set([p.x, p.y, p.z, p.x, 0, p.z], i * 6);
  }
  const idx = [];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    idx.push(i * 2, j * 2, i * 2 + 1, i * 2 + 1, j * 2, j * 2 + 1);
  }
  const rg = new THREE.BufferGeometry();
  rg.setAttribute('position', new THREE.BufferAttribute(ribbon, 3));
  rg.setIndex(idx);
  trackGroup.add(new THREE.Mesh(rg, new THREE.MeshBasicMaterial({ color: COLORS.flood, side: THREE.DoubleSide })));

  // Soft glow: a wider, faint ribbon underneath, like floodlight spill.
  const glow = new THREE.Mesh(rg.clone(), new THREE.MeshBasicMaterial({ color: COLORS.flood, transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false }));
  glow.scale.set(1, 1, 1);
  const gpos = glow.geometry.attributes.position;
  for (let i = 0; i < n; i++) {
    const p = P[i];
    for (const k of [0, 1]) {
      const vi = i * 2 + k;
      const vx = gpos.getX(vi), vz = gpos.getZ(vi);
      gpos.setXYZ(vi, p.x + (vx - p.x) * 3.2, p.y + 0.01, p.z + (vz - p.z) * 3.2);
    }
  }
  trackGroup.add(glow);

  // Curtain from the track down to the ground so elevation reads when rotated.
  const cg = new THREE.BufferGeometry();
  cg.setAttribute('position', new THREE.BufferAttribute(curtain, 3));
  cg.setIndex(idx);
  trackGroup.add(new THREE.Mesh(cg, new THREE.MeshBasicMaterial({ color: COLORS.flood, transparent: true, opacity: 0.07, side: THREE.DoubleSide, depthWrite: false })));

  // Start/finish: the reference lap begins at the line.
  const s0 = P[0];
  const s1 = P[2];
  tmp.subVectors(s1, s0).setY(0).normalize();
  const sf = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.1, 0.35), new THREE.MeshBasicMaterial({ color: COLORS.night }));
  sf.position.copy(s0).setY(s0.y + 0.06);
  sf.rotation.y = Math.atan2(tmp.x, tmp.z);
  trackGroup.add(sf);
}

function labelSprite(text, colour) {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 64;
  const g = c.getContext('2d');
  g.font = '700 38px "Barlow Semi Condensed", system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = 'rgba(14,22,38,0.85)';
  roundRect(g, 14, 10, 100, 44, 10);
  g.fill();
  g.fillStyle = colour;
  g.fillRect(14, 50, 100, 4);
  g.fillStyle = '#F2EBDD';
  g.fillText(text, 64, 32);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  s.scale.set(5, 2.5, 1);
  s.renderOrder = 10;
  return s;
}
function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

const carGeo = new THREE.SphereGeometry(0.85, 20, 14);
const hitGeo = new THREE.SphereGeometry(3, 8, 6);
const haloGeo = new THREE.TorusGeometry(1.7, 0.18, 8, 32);

function ensureCar(n) {
  let c = cars.get(n);
  if (c) return c;
  const d = state.drivers.get(n) || { code: String(n), colour: '#8C9AB5' };
  const mesh = new THREE.Mesh(carGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(d.colour), transparent: true }));
  const hit = new THREE.Mesh(hitGeo, new THREE.MeshBasicMaterial({ visible: false }));
  hit.userData.n = n;
  mesh.add(hit);
  const halo = new THREE.Mesh(haloGeo, new THREE.MeshBasicMaterial({ color: COLORS.flood }));
  halo.rotation.x = Math.PI / 2;
  halo.visible = false;
  mesh.add(halo);
  const label = labelSprite(d.code, d.colour);
  label.position.set(0, 3, 0);
  mesh.add(label);
  carGroup.add(mesh);
  c = { mesh, hit, halo, label, from: null, to: null, t0: 0, stale: false };
  cars.set(n, c);
  return c;
}

function clearCars() {
  for (const c of cars.values()) carGroup.remove(c.mesh);
  cars.clear();
}

// Tap to select (ignoring drags)
let down = null;
canvas.addEventListener('pointerdown', (e) => (down = { x: e.clientX, y: e.clientY }));
canvas.addEventListener('pointerup', (e) => {
  if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 8) return;
  const r = canvas.getBoundingClientRect();
  const v = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  const ray = new THREE.Raycaster();
  ray.setFromCamera(v, camera);
  const hits = ray.intersectObjects([...cars.values()].map((c) => c.hit), false);
  if (hits.length) select(hits[0].object.userData.n);
});

const vA = new THREE.Vector3();
let lastFrame = performance.now();
function animate(now) {
  requestAnimationFrame(animate);
  const dt = now - lastFrame;
  lastFrame = now;
  const leaders = new Set((state.timing?.rows || []).slice(0, 3).map((r) => r.n));
  for (const [n, c] of cars) {
    if (!c.to) continue;
    const f = Math.min(1, (now - c.t0) / FRAME_MS);
    if (c.from) c.mesh.position.lerpVectors(c.from, c.to, f);
    else c.mesh.position.copy(c.to);
    c.mesh.material.opacity = c.stale ? 0.3 : 1;
    const sel = n === state.sel;
    c.halo.visible = sel;
    c.label.visible = sel || state.allLabels || leaders.has(n);
    c.label.material.opacity = c.stale ? 0.4 : 1;
  }
  if (state.follow && state.sel != null && cars.get(state.sel)?.to) {
    vA.copy(cars.get(state.sel).mesh.position);
    const delta = vA.sub(controls.target).multiplyScalar(Math.min(1, dt / 200));
    controls.target.add(delta);
    camera.position.add(delta);
  }
  controls.update();
  renderer.render(scene, camera);
}
requestAnimationFrame(animate);

// ---------------- data stream ----------------

let es;
function connect() {
  if (es) es.close();
  es = new EventSource('/events');
  es.addEventListener('init', (e) => onInit(JSON.parse(e.data)));
  es.addEventListener('track', (e) => onTrack(JSON.parse(e.data)));
  es.addEventListener('status', (e) => onStatus(JSON.parse(e.data)));
  es.addEventListener('tick', (e) => onTick(JSON.parse(e.data)));
  es.onerror = () => {
    if (es.readyState === EventSource.CLOSED) setTimeout(connect, 3000);
  };
}
connect();
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    if (!es || es.readyState === EventSource.CLOSED) connect();
    requestWake();
  }
});

function onInit(d) {
  const changed = !state.session || !d.session || state.session.key !== d.session.key;
  state.session = d.session;
  state.mode = d.mode;
  state.sessions = d.sessions || [];
  state.canLive = d.canLive;
  const prevDrivers = state.drivers;
  state.drivers = new Map((d.drivers || []).map((x) => [x.n, x]));
  if (changed || prevDrivers.size !== state.drivers.size) {
    clearCars();
    state.history = [];
    state.timing = null;
  }
  if (changed) {
    state.track = null;
    state.transform = null;
    trackGroup.clear();
  }
  if (d.track) onTrack(d.track);
  onStatus(d.status);
  renderSessionSelect();
  renderHeader();
  renderControls();
}

function onTrack(t) {
  if (!t) return;
  const newTransform = !state.transform || JSON.stringify(state.transform) !== JSON.stringify(t.transform);
  state.track = t;
  state.transform = t.transform;
  buildTrack();
  if (newTransform) for (const c of cars.values()) c.from = null;
}

function onStatus(s) {
  if (!s) return;
  state.status = s;
  state.mode = s.mode || state.mode;
  const n = s.api?.requests ?? 0;
  const free = s.freeAt ? ` Free to replay from ${fmtWhen(s.freeAt)}.` : '';
  $('statusText').textContent = `${s.text.replace(/\.$/, '')}.${free} Using OpenF1 ${s.api?.authed ? 'sponsor' : 'free'} access, ${n} ${n === 1 ? 'request' : 'requests'} so far.`;
  renderOverlay();
  renderHeader();
  renderControls();
}

function onTick(f) {
  state.lastTick = f;
  state.mode = f.mode;
  state.replay = f.replay || null;
  state.live = f.live || null;
  const now = performance.now();
  for (const row of f.cars) {
    const [n, x, y, z, sp, gear, rpm, thr, brk, drs, stale] = row;
    if (!state.transform) continue;
    const c = ensureCar(n);
    const to = toWorld(x, y, z);
    to.y += 0.9;
    c.from = c.to ? c.mesh.position.clone() : null;
    // A jump of more than a quarter of the map (seek, session change) snaps instead of sliding.
    if (c.from && c.from.distanceTo(to) > 25) c.from = null;
    c.to = to;
    c.t0 = now;
    c.stale = Boolean(stale);
    c.tel = { sp, gear, rpm, thr, brk, drs };
  }
  if (f.timing) {
    state.timing = f.timing;
    state.timingByN = new Map(f.timing.rows.map((r) => [r.n, r]));
    if (state.sel == null && f.timing.rows[0]?.p) select(f.timing.rows[0].n, false);
    renderTower();
    renderHeader();
    renderRc();
  }
  const sc = cars.get(state.sel);
  if (sc?.tel) {
    state.history.push([f.t, sc.tel.sp, sc.tel.thr, sc.tel.brk]);
    while (state.history.length && f.t - state.history[0][0] > 30_000) state.history.shift();
    if (state.history.length > 1 && state.history.at(-1)[0] < state.history.at(-2)[0]) state.history = [state.history.at(-1)];
  }
  renderTele();
  renderClock();
  renderOverlay();
}

// ---------------- rendering ----------------

function fmtWhen(isoStr) {
  return new Date(isoStr).toLocaleString('en-AU', { weekday: 'short', hour: 'numeric', minute: '2-digit' });
}
function fmtLap(s) {
  if (s == null) return '–';
  const m = Math.floor(s / 60);
  const r = s - m * 60;
  return `${m}:${r.toFixed(3).padStart(6, '0')}`;
}
function fmtGap(v, p) {
  if (p === 1) return 'Leader';
  if (v == null) return '–';
  if (typeof v === 'string') return v;
  return `+${v.toFixed(3)}`;
}
function tyreHtml(c, age) {
  if (!c) return '<span class="tyre">?</span>';
  const letter = TYRE_LETTER[c] || c[0];
  return `<span class="tyre ${c}" title="${c.toLowerCase()}">${letter}</span>${age != null ? `<span>${age}</span>` : ''}`;
}
function esc(s) {
  return String(s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);
}

function renderHeader() {
  const s = state.session;
  $('sessname').textContent = s ? `${s.circuit || s.country} ${s.name.toLowerCase()}` : 'No session';
  const lap = state.timing?.lap;
  $('lap').innerHTML = lap ? `Lap <b>${lap}</b>` : '';
  const flag = state.timing?.flag || 'GREEN';
  const base = flag.replace(' ENDING', '');
  const band = $('flagband');
  band.className = `flag-${base}`;
  band.textContent = { YELLOW: 'Yellow flag', SC: 'Safety car', 'SC ENDING': 'Safety car in this lap', VSC: 'Virtual safety car', 'VSC ENDING': 'Virtual safety car ending', RED: 'Red flag', CHEQUERED: 'Chequered flag' }[flag] || '';
  const b = $('modebadge');
  b.className = `badge ${state.mode === 'live' ? 'live' : ''}`;
  b.textContent = { live: 'Live', replay: 'Replay', locked: 'Locked', idle: 'Loading' }[state.mode] || '';
}

function renderRc() {
  const m = state.timing?.rc?.[0];
  $('rc').textContent = m ? m.msg.charAt(0) + m.msg.slice(1).toLowerCase() : '';
  $('rc').title = m?.msg || '';
}

let towerKey = '';
function renderTower() {
  const rows = state.timing?.rows || [];
  const bestOverall = Math.min(...rows.map((r) => r.best ?? Infinity));
  const html = rows
    .map((r) => {
      const d = state.drivers.get(r.n) || { code: r.n, colour: '#8C9AB5' };
      const gap = state.gapMode === 'int' ? fmtGap(r.int, r.p) : fmtGap(r.gap, r.p);
      const pb = r.last != null && r.last === r.best;
      return `<li class="row ${r.n === state.sel ? 'sel' : ''}" data-n="${r.n}">
        <span class="p">${r.p ?? ''}</span>
        <span class="c" style="background:${esc(d.colour)}"></span>
        <span class="code">${esc(d.code)}${r.pit ? '<span class="pit">Pit</span>' : ''}</span>
        <span class="gap">${esc(gap)}</span>
        <span class="tyrecell">${tyreHtml(r.tyre, r.age)}</span>
        <span class="last ${pb ? 'pb' : ''}" style="${r.last != null && r.last === bestOverall ? 'color:var(--purple)' : ''}">${fmtLap(r.last)}</span>
      </li>`;
    })
    .join('');
  if (html !== towerKey) {
    $('rows').innerHTML = html;
    towerKey = html;
  }
}
$('rows').addEventListener('click', (e) => {
  const li = e.target.closest('.row');
  if (li) select(Number(li.dataset.n));
});
$('gapToggle').addEventListener('click', () => {
  state.gapMode = state.gapMode === 'int' ? 'gap' : 'int';
  $('gapToggle').textContent = state.gapMode === 'int' ? 'Interval' : 'To leader';
  towerKey = '';
  renderTower();
  savePrefs();
});
$('gapToggle').textContent = state.gapMode === 'int' ? 'Interval' : 'To leader';

function select(n, persist = true) {
  if (state.sel !== n) state.history = [];
  state.sel = n;
  towerKey = '';
  renderTower();
  renderTele();
  if (persist) savePrefs();
}

function renderTele() {
  const n = state.sel;
  const d = state.drivers.get(n);
  const r = state.timingByN.get(n);
  const tel = cars.get(n)?.tel;
  $('tSwatch').style.background = d?.colour || 'var(--haze)';
  $('tPos').textContent = r?.p ? `P${r.p}` : '–';
  $('tCode').textContent = d ? d.code : 'Tap a car';
  $('tTeam').textContent = d ? d.team : '';
  $('tTyre').innerHTML = r ? tyreHtml(r.tyre, r.age) : '';
  $('tSpeed').textContent = tel?.sp ?? '–';
  $('tGear').textContent = tel?.gear ? tel.gear : tel ? 'N' : '–';
  $('bThr').style.width = `${Math.max(0, Math.min(100, tel?.thr ?? 0))}%`;
  $('bBrk').style.width = `${tel?.brk ? Math.min(100, tel.brk) : 0}%`;
  $('bRpm').style.width = `${Math.min(100, ((tel?.rpm ?? 0) / 13000) * 100)}%`;
  $('tRpm').textContent = tel?.rpm ? tel.rpm.toLocaleString('en-AU') : '';
  $('tGap').textContent = r ? fmtGap(state.gapMode === 'int' ? r.int : r.gap, r.p) : '–';
  $('tLast').textContent = fmtLap(r?.last);
  $('tBest').textContent = fmtLap(r?.best);
  drawSpark();
}

function drawSpark() {
  const c = $('spark');
  const w = c.clientWidth;
  const h = c.clientHeight;
  const dpr = Math.min(window.devicePixelRatio, 2);
  if (c.width !== Math.round(w * dpr)) {
    c.width = Math.round(w * dpr);
    c.height = Math.round(h * dpr);
  }
  const g = c.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  const H = state.history;
  if (H.length < 2) return;
  const t1 = H.at(-1)[0];
  const t0 = t1 - 30_000;
  const X = (t) => ((t - t0) / 30_000) * w;
  const maxV = 360;
  // Brake zones as red bands along the bottom, throttle as a faint green band.
  for (let i = 1; i < H.length; i++) {
    const x0 = X(H[i - 1][0]);
    const x1 = X(H[i][0]);
    if (H[i][3] > 0) {
      g.fillStyle = 'rgba(229,56,59,.85)';
      g.fillRect(x0, h - 5, Math.max(1, x1 - x0), 5);
    } else if (H[i][2] > 90) {
      g.fillStyle = 'rgba(43,182,115,.45)';
      g.fillRect(x0, h - 3, Math.max(1, x1 - x0), 3);
    }
  }
  g.strokeStyle = '#F2EBDD';
  g.lineWidth = 1.75;
  g.lineJoin = 'round';
  g.beginPath();
  H.forEach((p, i) => {
    const x = X(p[0]);
    const y = h - 7 - ((p[1] ?? 0) / maxV) * (h - 9);
    i ? g.lineTo(x, y) : g.moveTo(x, y);
  });
  g.stroke();
  g.fillStyle = '#8C9AB5';
  g.font = '12px "Barlow Semi Condensed", sans-serif';
  g.fillText('Speed, last 30 s', 2, 10);
}

function renderOverlay() {
  const o = $('overlay');
  const s = state.status;
  let msg = '';
  if (state.mode === 'locked') {
    msg = `${(s?.text || 'Live data is locked').replace(/\.$/, '')}.`;
    if (s?.freeAt) msg += ` This session can be replayed for free from ${fmtWhen(s.freeAt)}.`;
    msg += ' Open settings to pick a finished session.';
  } else if (s?.level === 'error') msg = s.text;
  else if (!state.lastTick || !state.lastTick.cars.length) msg = s?.text && s.level !== 'ok' ? `${s.text}…` : state.mode === 'live' ? 'Waiting for cars on track…' : 'Loading car positions…';
  o.hidden = !msg;
  o.innerHTML = msg ? `<p>${esc(msg)}</p>` : '';
}

function renderSessionSelect() {
  const sel = $('sessSelect');
  sel.innerHTML = state.sessions
    .map((s) => {
      const when = new Date(s.start).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });
      return `<option value="${s.key}" ${state.session?.key === s.key ? 'selected' : ''}>${esc(s.label)}, ${when}${s.live ? ' (live)' : ''}</option>`;
    })
    .join('');
}

function renderControls() {
  const isReplay = state.mode === 'replay';
  const isLive = state.mode === 'live';
  $('replayCtl').hidden = !isReplay;
  $('liveCtl').hidden = !isLive;
  $('controls').hidden = !isReplay && !isLive;
  const sessLive = state.sessions.find((s) => s.key === state.session?.key)?.live;
  $('toLiveBtn').hidden = !(isReplay && sessLive && state.canLive);
  renderClock();
}

const PLAY = '<path d="M7 5v14l12-7z" fill="currentColor"/>';
const PAUSE = '<path d="M6 5h4v14H6zM14 5h4v14h-4z" fill="currentColor"/>';
function renderClock() {
  if (state.mode === 'replay' && state.replay && state.lastTick) {
    const { start, end, playing, speed } = state.replay;
    const el = Math.max(0, state.lastTick.t - start) / 1000;
    const h = Math.floor(el / 3600);
    const m = Math.floor((el % 3600) / 60);
    const s = Math.floor(el % 60);
    $('clock').textContent = `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    if (!state.scrubbing) $('scrub').value = String(Math.round(((state.lastTick.t - start) / (end - start)) * 1000));
    $('playIcon').innerHTML = playing ? PAUSE : PLAY;
    $('playBtn').setAttribute('aria-label', playing ? 'Pause' : 'Play');
    $('speedBtn').textContent = `${speed}×`;
  }
  if (state.mode === 'live' && state.live) $('delayVal').textContent = state.live.delayS;
}

// ---------------- controls ----------------

async function post(body) {
  try {
    await fetch('/api/control', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  } catch (e) {
    console.error(e);
  }
}

$('playBtn').addEventListener('click', () => post({ playing: !state.replay?.playing }));
const SPEEDS = [1, 2, 4, 8, 16];
$('speedBtn').addEventListener('click', () => {
  const i = SPEEDS.indexOf(state.replay?.speed ?? 1);
  post({ speed: SPEEDS[(i + 1) % SPEEDS.length] });
});
$('scrub').addEventListener('input', () => (state.scrubbing = true));
$('scrub').addEventListener('change', () => {
  state.scrubbing = false;
  if (!state.replay) return;
  const { start, end } = state.replay;
  post({ at: start + (Number($('scrub').value) / 1000) * (end - start) });
  state.history = [];
});
$('delayMinus').addEventListener('click', () => post({ delayS: (state.live?.delayS ?? 10) - 5 }));
$('delayPlus').addEventListener('click', () => post({ delayS: (state.live?.delayS ?? 10) + 5 }));
$('fromStartBtn').addEventListener('click', () => post({ session: state.session.key, mode: 'replay' }));
$('toLiveBtn').addEventListener('click', () => post({ session: state.session.key, mode: 'live' }));

$('followBtn').addEventListener('click', () => {
  state.follow = !state.follow;
  $('followBtn').setAttribute('aria-pressed', String(state.follow));
});
$('resetBtn').addEventListener('click', () => {
  state.follow = false;
  $('followBtn').setAttribute('aria-pressed', 'false');
  resetView();
});

$('menuBtn').addEventListener('click', () => $('menu').showModal());
$('sessSelect').addEventListener('change', () => post({ session: Number($('sessSelect').value) }));
$('autoBtn').addEventListener('click', () => {
  post({ follow: 'auto' });
  $('menu').close();
});
$('zx').value = state.zx;
$('zxVal').textContent = `${state.zx}×`;
$('zx').addEventListener('input', () => {
  state.zx = Number($('zx').value);
  $('zxVal').textContent = `${state.zx}×`;
  buildTrack();
  for (const c of cars.values()) c.from = null;
  savePrefs();
});
$('allLabels').checked = state.allLabels;
$('allLabels').addEventListener('change', () => {
  state.allLabels = $('allLabels').checked;
  savePrefs();
});

// Keep the phone awake while watching.
let wakeLock = null;
async function requestWake() {
  if (!$('wake').checked || !('wakeLock' in navigator) || document.visibilityState !== 'visible') return;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
  } catch {}
}
document.addEventListener('pointerdown', () => !wakeLock && requestWake(), { once: true });
$('wake').addEventListener('change', () => {
  if ($('wake').checked) requestWake();
  else if (wakeLock) wakeLock.release().then(() => (wakeLock = null));
});
