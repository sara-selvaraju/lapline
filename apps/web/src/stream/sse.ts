// The SSE client. Everything the UI shows arrives through here.
//
// Every message is validated against the protocol schema before it reaches the
// store, so a malformed frame is dropped rather than corrupting the view. The
// protocol version is checked on hello: a mismatch means the server was
// redeployed with a different wire format, and the page reloads to catch up.

import {
  CircuitSchema,
  EVENT_SCHEMAS,
  HelloSchema,
  PROTOCOL_VERSION,
  StatusSchema,
  TickSchema,
  TimingSchema,
  type Circuit,
  type Hello,
  type SseEvent,
  type Status,
  type Tick,
  type Timing,
} from '@lapline/shared';
import { cars, clearCars, ensureCar } from '../scene/cars.js';
import { buildTrack, toWorld, trackGroup } from '../scene/track.js';
import { state } from '../state.js';
import { renderClock, renderControls } from '../ui/controls.js';
import { renderHeader, renderRc } from '../ui/header.js';
import { renderOverlay } from '../ui/overlay.js';
import { select } from '../ui/selection.js';
import { renderSessionSelect, renderStatusText, requestWake } from '../ui/settings.js';
import { renderTele } from '../ui/telemetry.js';
import { renderTower } from '../ui/tower.js';

/** A jump of more than a quarter of the map means a seek, so snap instead of sliding. */
const SNAP_DISTANCE = 25;

let es: EventSource | undefined;
/** Only reload once, so a persistently wrong version cannot loop the page. */
let reloadedForVersion = false;

/** Parses and validates one event payload, or returns null and says why. */
function parse<E extends SseEvent>(event: E, raw: string): unknown | null {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    console.error(`${event}: not JSON`);
    return null;
  }
  const result = EVENT_SCHEMAS[event].safeParse(json);
  if (!result.success) {
    console.error(`${event}: does not match protocol v${PROTOCOL_VERSION}`, result.error.issues.slice(0, 3));
    return null;
  }
  return result.data;
}

export function connect(): void {
  if (es) es.close();
  es = new EventSource('/events');
  es.addEventListener('hello', (e) => {
    const d = parse('hello', e.data);
    if (d) onHello(HelloSchema.parse(d));
  });
  es.addEventListener('circuit', (e) => {
    const d = parse('circuit', e.data);
    if (d) onCircuit(CircuitSchema.parse(d));
  });
  es.addEventListener('status', (e) => {
    const d = parse('status', e.data);
    if (d) onStatus(StatusSchema.parse(d));
  });
  es.addEventListener('tick', (e) => {
    const d = parse('tick', e.data);
    if (d) onTick(TickSchema.parse(d));
  });
  es.addEventListener('timing', (e) => {
    const d = parse('timing', e.data);
    if (d) onTiming(TimingSchema.parse(d));
  });
  es.onerror = () => {
    if (es?.readyState === EventSource.CLOSED) setTimeout(connect, 3000);
  };
}

export function onHello(d: Hello): void {
  // A server speaking a different protocol cannot be read; reload to get the
  // matching client bundle.
  if (d.protocolVersion !== PROTOCOL_VERSION && !reloadedForVersion) {
    reloadedForVersion = true;
    console.warn(`protocol v${d.protocolVersion} from the server, this client is v${PROTOCOL_VERSION}; reloading`);
    location.reload();
    return;
  }

  const changed = !state.session || !d.session || state.session.key !== d.session.key;
  state.session = d.session;
  state.mode = d.mode;
  state.sessions = d.sessions;
  state.canLive = d.canLive;

  const prevDrivers = state.drivers;
  state.drivers = new Map(d.drivers.map((x) => [x.n, x]));
  // A different field means the car meshes carry the wrong colours and codes.
  if (changed || prevDrivers.size !== state.drivers.size) {
    clearCars();
    state.history = [];
    state.timing = null;
  }
  if (changed) {
    state.circuit = null;
    state.transform = null;
    trackGroup.clear();
  }

  if (d.circuit) onCircuit(d.circuit);
  onStatus(d.status);
  renderSessionSelect();
  renderHeader();
  renderControls();
}

export function onCircuit(c: Circuit): void {
  const newTransform = !state.transform || JSON.stringify(state.transform) !== JSON.stringify(c.transform);
  state.circuit = c;
  state.transform = c.transform;
  buildTrack();
  // Positions computed under the old transform are meaningless now.
  if (newTransform) for (const car of cars.values()) car.from = null;
}

export function onStatus(s: Status): void {
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
  state.replay = f.replay ?? null;
  state.live = f.live ?? null;

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

export function onTiming(t: Timing): void {
  state.timing = t;
  state.timingByN = new Map(t.rows.map((r) => [r.n, r]));
  // Nothing chosen yet: start on the leader rather than an empty panel.
  if (state.sel == null && t.rows[0]?.p) select(t.rows[0].n, false);
  renderTower();
  renderHeader();
  renderRc();
  renderTele();
}

export function watchVisibility(): void {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      if (!es || es.readyState === EventSource.CLOSED) connect();
      void requestWake();
    }
  });
}
