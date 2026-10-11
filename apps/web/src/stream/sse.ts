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
import { useStore } from '../store/store.js';
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

  const before = useStore.getState();
  const fieldChanged =
    !before.session || !d.session || before.session.key !== d.session.key || before.drivers.size !== d.drivers.length;

  useStore.getState().applyHello(d);
  if (fieldChanged) {
    clearCars();
    trackGroup.clear();
  }

  if (d.circuit) onCircuit(d.circuit);
  onStatus(d.status);
  renderSessionSelect();
  renderHeader();
  renderControls();
}

export function onCircuit(c: Circuit): void {
  const before = useStore.getState().circuitEpoch;
  useStore.getState().applyCircuit(c);
  buildTrack();
  // Positions computed under the old transform are meaningless now.
  if (useStore.getState().circuitEpoch !== before) for (const car of cars.values()) car.from = null;
}

export function onStatus(s: Status): void {
  useStore.getState().applyStatus(s);
  renderStatusText();
  renderOverlay();
  renderHeader();
  renderControls();
}

export function onTick(f: Tick): void {
  useStore.getState().applyTick(f);
  const { transform, sel } = useStore.getState();

  const now = performance.now();
  for (const row of f.cars) {
    const [n, x, y, z, sp, gear, rpm, thr, brk, drs, stale] = row;
    if (!transform) continue;
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
  void sel;

  renderTele();
  renderClock();
  renderOverlay();
}

export function onTiming(t: Timing): void {
  useStore.getState().applyTiming(t);
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
