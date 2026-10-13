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
import { getScene } from '../scene/instance.js';
import { useStore } from '../store/store.js';
import { fetchPeriods } from './queries.js';

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

/**
 * How long without a word before the stream counts as stalled.
 *
 * docs/ARCHITECTURE.md asks for "a visible freshness signal within 6 s of the
 * stream stalling", and that six seconds is the whole budget — detection
 * included. A five second silence judged twice a second shows the banner by
 * about five and a half, where judging six seconds once a second missed it.
 */
export const STALL_MS = 5000;

/** How often the staleness is re-judged, which also drives the banner's counter. */
const WATCH_MS = 500;

let watch: ReturnType<typeof setInterval> | null = null;

/** Any event at all, ping included, means the stream is alive. */
function heard(): void {
  useStore.getState().noteEvent(Date.now());
}

export function connect(): void {
  if (es) es.close();
  es = new EventSource('/events');
  const on = <E extends SseEvent>(event: E, handle: (d: never) => void): void => {
    es!.addEventListener(event, (e) => {
      heard();
      const d = parse(event, (e as MessageEvent<string>).data);
      if (d !== null) handle(d as never);
    });
  };
  on('hello', onHello);
  on('circuit', onCircuit);
  on('status', onStatus);
  on('tick', onTick);
  on('timing', onTiming);
  // The server has pinged every 15 s since M0 and nothing listened. It is the
  // only thing that still arrives when a session is idle, so it is what keeps
  // the stall detector honest between frames.
  on('ping', () => {});

  es.onopen = heard;
  es.onerror = () => {
    if (es?.readyState === EventSource.CLOSED) setTimeout(connect, 3000);
  };

  if (!watch) {
    watch = setInterval(() => {
      const { lastEventAt, stalled, setStalled } = useStore.getState();
      const quiet = lastEventAt == null ? false : Date.now() - lastEventAt > STALL_MS;
      if (quiet !== stalled) setStalled(quiet);
      // A browser that has closed the stream will not reopen it on its own.
      if (quiet && es?.readyState === EventSource.CLOSED) connect();
    }, WATCH_MS);
  }
}

/** Reconnect now, for the banner's "Retry now". */
export function retryNow(): void {
  connect();
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
  // The car meshes carry driver colours and codes, so a new field means
  // throwing them away rather than recolouring in place.
  if (fieldChanged) getScene()?.clearCars();
  if (d.circuit) onCircuit(d.circuit);

  const after = useStore.getState();
  // The scrubber's markings, once per session. Replay only: they mark a
  // scrubber that live mode does not have.
  if (d.mode === 'replay' && after.periods == null) {
    void fetchPeriods().then((r) => {
      if (r) useStore.getState().setPeriods(r.periods);
    });
  }

  // A delay this phone worked out earlier for this session. The server holds
  // one delay for everyone, so this re-asserts ours on opening the session.
  const key = d.session?.key;
  if (d.mode === 'live' && key != null) {
    const remembered = after.delays[String(key)];
    // Hello arrives on connect and on a session change, not every frame, so
    // re-asserting here is cheap and happens exactly when it should.
    if (remembered != null) after.setDelay(remembered);
  }
}

export function onCircuit(c: Circuit): void {
  // The component rebuilds the track from the store, so this only has to store it.
  useStore.getState().applyCircuit(c);
}

export function onStatus(s: Status): void {
  useStore.getState().applyStatus(s);
}

export function onTick(f: Tick): void {
  useStore.getState().applyTick(f);
  // Straight to the scene: positions must not wait on a React render.
  getScene()?.setFrame(f);
}

export function onTiming(t: Timing): void {
  useStore.getState().applyTiming(t);
}

export function watchVisibility(): void {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && (!es || es.readyState === EventSource.CLOSED)) connect();
  });
}
