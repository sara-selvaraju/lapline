// The SSE client. The only thing that writes to the store.
//
// Every message is validated against the protocol schema before it reaches the
// store, so a malformed frame is dropped rather than corrupting the view. The
// protocol version is checked on hello: a mismatch means the server was
// redeployed with a different wire format, and the page reloads to catch up.
//
// Components re-render from the store, so nothing here touches the DOM. The one
// exception is the scene, which is imperative by design and needs the raw tick.

import {
  EVENT_SCHEMAS,
  PROTOCOL_VERSION,
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

/** A jump of more than a quarter of the map means a seek, so snap instead of sliding. */
const SNAP_DISTANCE = 25;

let es: EventSource | undefined;
/** Only reload once, so a persistently wrong version cannot loop the page. */
let reloadedForVersion = false;

/**
 * Whether a hello from this server means the page should reload.
 *
 * Pure so it can be tested: the reload itself is one line that cannot run
 * outside a browser, but the rule about when to reload is worth pinning. The
 * guard matters — a server stuck on the wrong version would otherwise reload
 * the page every few seconds forever.
 */
export function shouldReloadForProtocol(
  serverVersion: number,
  clientVersion: number,
  alreadyReloaded: boolean,
): boolean {
  return serverVersion !== clientVersion && !alreadyReloaded;
}

/** Validates one payload against the protocol, or returns null and says why. */
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
  const on = <E extends SseEvent>(event: E, handle: (d: never) => void): void => {
    es!.addEventListener(event, (e) => {
      const d = parse(event, (e as MessageEvent<string>).data);
      if (d !== null) handle(d as never);
    });
  };
  on('hello', onHello);
  on('circuit', onCircuit);
  on('status', onStatus);
  on('tick', onTick);
  on('timing', onTiming);
  es.onerror = () => {
    if (es?.readyState === EventSource.CLOSED) setTimeout(connect, 3000);
  };
}

export function onHello(d: Hello): void {
  // A server speaking a different protocol cannot be read; reload to get the
  // matching client bundle.
  if (shouldReloadForProtocol(d.protocolVersion, PROTOCOL_VERSION, reloadedForVersion)) {
    reloadedForVersion = true;
    console.warn(`protocol v${d.protocolVersion} from the server, this client is v${PROTOCOL_VERSION}; reloading`);
    location.reload();
    return;
  }

  const before = useStore.getState();
  const fieldChanged =
    !before.session || !d.session || before.session.key !== d.session.key || before.drivers.size !== d.drivers.length;

  useStore.getState().applyHello(d);
  // The scene's car meshes carry driver colours and codes, so a new field means
  // throwing them away rather than recolouring in place.
  if (fieldChanged) {
    clearCars();
    trackGroup.clear();
  }
  if (d.circuit) onCircuit(d.circuit);
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
}

export function onTick(f: Tick): void {
  useStore.getState().applyTick(f);
  const { transform } = useStore.getState();
  if (!transform) return;

  const now = performance.now();
  for (const row of f.cars) {
    const [n, x, y, z, , , , , , , stale] = row;
    const c = ensureCar(n);
    const to = toWorld(x, y, z);
    to.y += 0.9;
    c.from = c.to ? c.mesh.position.clone() : null;
    if (c.from && c.from.distanceTo(to) > SNAP_DISTANCE) c.from = null;
    c.to = to;
    c.t0 = now;
    c.stale = Boolean(stale);
  }
}

export function onTiming(t: Timing): void {
  useStore.getState().applyTiming(t);
}

export function watchVisibility(): void {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && (!es || es.readyState === EventSource.CLOSED)) connect();
  });
}
