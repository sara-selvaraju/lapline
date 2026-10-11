// The SSE client. Everything the UI shows arrives through here.
//
// EventSource reconnects on its own for transport errors; the explicit retry
// covers the case where it gives up and closes.
//
// Ported from reference/prototype/public/app.js.

import type { InitPayload, StatusPayload, Tick, TrackPayload } from '@lapline/shared';
import { cars, clearCars, ensureCar } from '../scene/cars.js';
import { buildTrack, toWorld, trackGroup } from '../scene/track.js';
import { state } from '../state.js';
import { renderControls, renderClock } from '../ui/controls.js';
import { renderHeader, renderRc } from '../ui/header.js';
import { renderOverlay } from '../ui/overlay.js';
import { select } from '../ui/selection.js';
import { renderSessionSelect, renderStatusText, requestWake } from '../ui/settings.js';
import { renderTele } from '../ui/telemetry.js';
import { renderTower } from '../ui/tower.js';

/** A jump of more than a quarter of the map means a seek, so snap instead of sliding. */
const SNAP_DISTANCE = 25;

let es: EventSource | undefined;

export function connect(): void {
  if (es) es.close();
  es = new EventSource('/events');
  es.addEventListener('init', (e) => onInit(JSON.parse(e.data) as InitPayload));
  es.addEventListener('track', (e) => onTrack(JSON.parse(e.data) as TrackPayload | null));
  es.addEventListener('status', (e) => onStatus(JSON.parse(e.data) as StatusPayload));
  es.addEventListener('tick', (e) => onTick(JSON.parse(e.data) as Tick));
  es.onerror = () => {
    if (es?.readyState === EventSource.CLOSED) setTimeout(connect, 3000);
  };
}

export function onInit(d: InitPayload): void {
  const changed = !state.session || !d.session || state.session.key !== d.session.key;
  state.session = d.session;
  state.mode = d.mode;
  state.sessions = d.sessions || [];
  state.canLive = d.canLive;

  const prevDrivers = state.drivers;
  state.drivers = new Map((d.drivers || []).map((x) => [x.n, x]));
  // A different field means the car meshes carry the wrong colours and codes.
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

export function onTrack(t: TrackPayload | null): void {
  if (!t) return;
  const newTransform = !state.transform || JSON.stringify(state.transform) !== JSON.stringify(t.transform);
  state.track = t;
  state.transform = t.transform;
  buildTrack();
  // Positions computed under the old transform are meaningless now.
  if (newTransform) for (const c of cars.values()) c.from = null;
}

export function onStatus(s: StatusPayload | null): void {
  if (!s) return;
  state.status = s;
  state.mode = s.mode || state.mode;
  renderStatusText();
  renderOverlay();
  renderHeader();
  renderControls();
}

export function onTick(f: Tick): void {
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
    if (c.from && c.from.distanceTo(to) > SNAP_DISTANCE) c.from = null;
    c.to = to;
    c.t0 = now;
    c.stale = Boolean(stale);
    c.tel = { sp, gear, rpm, thr, brk, drs };
  }

  if (f.timing) {
    state.timing = f.timing;
    state.timingByN = new Map(f.timing.rows.map((r) => [r.n, r]));
    // Nothing chosen yet: start on the leader rather than an empty panel.
    if (state.sel == null && f.timing.rows[0]?.p) select(f.timing.rows[0].n, false);
    renderTower();
    renderHeader();
    renderRc();
  }

  const sc = state.sel != null ? cars.get(state.sel) : undefined;
  if (sc?.tel) {
    state.history.push([f.t, sc.tel.sp, sc.tel.thr, sc.tel.brk]);
    while (state.history.length && f.t - state.history[0]![0] > 30_000) state.history.shift();
    // A seek can move the clock backwards; a trace spanning it would be a lie.
    if (state.history.length > 1 && state.history.at(-1)![0] < state.history.at(-2)![0]) {
      state.history = [state.history.at(-1)!];
    }
  }

  renderTele();
  renderClock();
  renderOverlay();
}

export function watchVisibility(): void {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      if (!es || es.readyState === EventSource.CLOSED) connect();
      void requestWake();
    }
  });
}
