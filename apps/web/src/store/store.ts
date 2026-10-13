// The one store. Fed only by the SSE client; components subscribe to slices.
//
// Ticks live here too, at 4 Hz. That is safe because Zustand only re-renders a
// component when the slice it selected changes: the scene reads the tick
// straight off the store each frame without React involvement, and the one
// component that does show per-frame values — the driver strip — is small.
// Do not select the whole state anywhere.

import { create } from 'zustand';
import type {
  Circuit,
  Driver,
  Hello,
  LiveMeta,
  ReplayMeta,
  SessionResult,
  Status,
  Tick,
  Timing,
  TowerRow,
  Transform,
} from '@lapline/shared';
import { post } from '../stream/control.js';
import type { FlagPeriod } from '../stream/queries.js';
import { DEFAULT_PREFS, loadPrefs, savePrefs, type CameraPreset, type GapMode, type Prefs } from './prefs.js';

/** One sample of the selected car, for the 30-second speed trace. */
export type HistorySample = [t: number, speed: number | null, throttle: number | null, brake: number | null];

export interface StoreState {
  // ---- from the server ----
  session: Hello['session'];
  sessions: Hello['sessions'];
  mode: string;
  drivers: Map<number, Driver>;
  circuit: Circuit | null;
  transform: Transform | null;
  status: Status | null;
  canLive: boolean;
  /** The final classification, once the session has finished. */
  result: SessionResult | null;
  tick: Tick | null;
  timing: Timing | null;
  timingByN: Map<number, TowerRow>;
  replay: ReplayMeta | null;
  live: LiveMeta | null;

  // ---- local ----
  sel: number | null;
  gapMode: GapMode;
  zx: number;
  allLabels: boolean;
  camera: CameraPreset;
  showTurns: boolean;
  showSectors: boolean;
  showPitLane: boolean;
  /** Whether the telemetry panel is open. */
  expanded: boolean;
  /** Delays remembered per session key, from prefs. */
  delays: Record<string, number>;
  followLive: boolean;
  keepAwake: boolean;
  follow: boolean;
  scrubbing: boolean;
  /** Driver numbers under the last ambiguous tap, or null when closed. */
  picker: number[] | null;
  /** Whether the session list sheet is open. */
  sessionsOpen: boolean;
  /** Whether the sync sheet is open. */
  syncOpen: boolean;
  /** Flag periods for the replay scrubber, fetched once per session. */
  periods: FlagPeriod[] | null;
  /** When the stream last said anything, ping included. */
  lastEventAt: number | null;
  /** Whether the stream has gone quiet for longer than it should. */
  stalled: boolean;
  /** Whether the settings page is open. */
  settingsOpen: boolean;
  /**
   * Glance mode, which is a posture rather than a preference: propping the
   * phone up for a while. Deliberately not persisted — a mode that survives a
   * reload is a puzzle to get out of.
   */
  glance: boolean;
  history: HistorySample[];
  /** Bumps whenever the circuit's transform changes, so the scene can rebuild. */
  circuitEpoch: number;

  // ---- actions ----
  applyHello: (h: Hello) => void;
  applyCircuit: (c: Circuit) => void;
  applyStatus: (s: Status) => void;
  applyTick: (t: Tick) => void;
  applyTiming: (t: Timing) => void;
  select: (n: number, persist?: boolean) => void;
  /** Moves the selection down (+1) or up (-1) the running order. */
  selectByOffset: (delta: number) => void;
  setExpanded: (expanded: boolean) => void;
  setGapMode: (m: GapMode) => void;
  setZx: (zx: number) => void;
  setAllLabels: (on: boolean) => void;
  setCamera: (p: CameraPreset) => void;
  setLayer: (layer: 'showTurns' | 'showSectors' | 'showPitLane', on: boolean) => void;
  setFollow: (on: boolean) => void;
  setScrubbing: (on: boolean) => void;
  openPicker: (ns: number[]) => void;
  openSessions: () => void;
  openSync: () => void;
  closeSync: () => void;
  /** Sets the delay and remembers it for this session on this phone. */
  setDelay: (delayS: number) => void;
  setPeriods: (periods: FlagPeriod[]) => void;
  noteEvent: (at: number) => void;
  setStalled: (stalled: boolean) => void;
  openSettings: () => void;
  setGlance: (on: boolean) => void;
  setFollowLive: (on: boolean) => void;
  setKeepAwake: (on: boolean) => void;
  closeSettings: () => void;
  closeSessions: () => void;
  chooseSession: (key: number) => void;
  replayFromStart: () => void;
  closePicker: () => void;
  clearHistory: () => void;
}

const prefs = loadPrefs();

const persist = (s: StoreState): void => {
  savePrefs({
    sel: s.sel,
    gapMode: s.gapMode,
    zx: s.zx,
    allLabels: s.allLabels,
    camera: s.camera,
    showTurns: s.showTurns,
    showSectors: s.showSectors,
    showPitLane: s.showPitLane,
    expanded: s.expanded,
    delays: s.delays,
    followLive: s.followLive,
    keepAwake: s.keepAwake,
  } satisfies Prefs);
};

export const useStore = create<StoreState>((set, get) => ({
  session: null,
  sessions: [],
  mode: 'idle',
  drivers: new Map(),
  circuit: null,
  transform: null,
  status: null,
  canLive: false,
  result: null,
  tick: null,
  timing: null,
  timingByN: new Map(),
  replay: null,
  live: null,

  sel: prefs.sel ?? DEFAULT_PREFS.sel,
  gapMode: prefs.gapMode,
  zx: prefs.zx,
  allLabels: prefs.allLabels,
  camera: prefs.camera,
  showTurns: prefs.showTurns,
  showSectors: prefs.showSectors,
  showPitLane: prefs.showPitLane,
  delays: prefs.delays,
  followLive: prefs.followLive,
  keepAwake: prefs.keepAwake,
  expanded: prefs.expanded,
  follow: false,
  scrubbing: false,
  picker: null,
  sessionsOpen: false,
  syncOpen: false,
  periods: null,
  lastEventAt: null,
  stalled: false,
  settingsOpen: false,
  glance: false,
  history: [],
  circuitEpoch: 0,

  applyHello: (h) =>
    set((s) => {
      const changed = !s.session || !h.session || s.session.key !== h.session.key;
      const drivers = new Map(h.drivers.map((d) => [d.n, d]));
      // A different field means the scene's cars carry the wrong colours and codes.
      const fieldChanged = changed || s.drivers.size !== drivers.size;
      return {
        session: h.session,
        sessions: h.sessions,
        mode: h.mode,
        drivers,
        canLive: h.canLive,
        result: h.result,
        // A different session means the scrubber's markings belong to the
        // old one, and the remembered delay belongs to the new one.
        periods: changed ? null : s.periods,
        status: h.status,
        ...(fieldChanged ? { history: [], timing: null, timingByN: new Map() } : {}),
        ...(changed ? { circuit: null, transform: null, circuitEpoch: s.circuitEpoch + 1 } : {}),
      };
    }),

  applyCircuit: (c) =>
    set((s) => {
      const newTransform = !s.transform || JSON.stringify(s.transform) !== JSON.stringify(c.transform);
      return {
        circuit: c,
        transform: c.transform,
        circuitEpoch: newTransform ? s.circuitEpoch + 1 : s.circuitEpoch,
      };
    }),

  applyStatus: (status) => set((s) => ({ status, mode: status.mode || s.mode })),

  applyTick: (tick) =>
    set((s) => {
      const next: Partial<StoreState> = {
        tick,
        mode: tick.mode,
        replay: tick.replay ?? null,
        live: tick.live ?? null,
      };
      // The trace follows the selected car only, over the last 30 s of session time.
      if (s.sel != null) {
        const car = tick.cars.find((c) => c[0] === s.sel);
        // A paused replay still ticks four times a second, with the clock
        // frozen. Appending those grew the trace without bound — the 30 s
        // window below trims by `tick.t`, which is not moving — and every
        // sample was a repeat of the one before it, so there was nothing to
        // draw either. Ignore a tick that has not advanced the clock.
        if (car && tick.t !== s.history.at(-1)?.[0]) {
          const history = [...s.history, [tick.t, car[4], car[7], car[8]] as HistorySample];
          while (history.length && tick.t - history[0]![0] > 30_000) history.shift();
          // A seek can move the clock backwards; a trace spanning it would be a lie.
          next.history =
            history.length > 1 && history.at(-1)![0] < history.at(-2)![0] ? [history.at(-1)!] : history;
        }
      }
      return next;
    }),

  applyTiming: (timing) =>
    set((s) => {
      const timingByN = new Map(timing.rows.map((r) => [r.n, r]));
      // Nothing chosen yet: start on the leader rather than an empty panel.
      const sel = s.sel == null && timing.rows[0]?.p ? timing.rows[0].n : s.sel;
      return { timing, timingByN, sel };
    }),

  setExpanded: (expanded) =>
    set((s) => {
      persist({ ...s, expanded });
      return { expanded };
    }),

  /**
   * Selects the car ahead or behind in the running order.
   *
   * Resolved against the tower's own ordering rather than by arithmetic on
   * position numbers, because positions go missing: a car without one sits at
   * the bottom, and the order is what the viewer is looking at anyway. Stops
   * at the ends rather than wrapping, since walking off the back of the field
   * and reappearing at the front is disorienting on a phone.
   */
  selectByOffset: (delta) =>
    set((s) => {
      const rows = s.timing?.rows ?? [];
      if (rows.length === 0) return {};
      const at = rows.findIndex((r) => r.n === s.sel);
      const next = rows[at < 0 ? 0 : Math.min(rows.length - 1, Math.max(0, at + delta))];
      if (!next || next.n === s.sel) return {};
      const patch = { sel: next.n, history: [] as StoreState['history'], picker: null };
      persist({ ...s, ...patch });
      return patch;
    }),

  select: (n, persistPref = true) =>
    set((s) => {
      // The trace belongs to one driver; carrying it over would draw a line
      // that never happened.
      const next = { sel: n, history: s.sel === n ? s.history : [], picker: null };
      if (persistPref) persist({ ...s, ...next });
      return next;
    }),

  setGapMode: (gapMode) =>
    set((s) => {
      persist({ ...s, gapMode });
      return { gapMode };
    }),

  setZx: (zx) =>
    set((s) => {
      persist({ ...s, zx });
      return { zx, circuitEpoch: s.circuitEpoch + 1 };
    }),

  setAllLabels: (allLabels) =>
    set((s) => {
      persist({ ...s, allLabels });
      return { allLabels };
    }),

  setCamera: (camera) =>
    set((s) => {
      persist({ ...s, camera });
      // Choosing a preset is an explicit framing, so it cancels follow.
      return { camera, follow: false };
    }),

  setLayer: (layer, on) =>
    set((s) => {
      const next = { [layer]: on } as Pick<StoreState, typeof layer>;
      persist({ ...s, ...next });
      // The scene rebuilds its detail from the epoch, as it does for elevation.
      return { ...next, circuitEpoch: s.circuitEpoch + 1 };
    }),

  setFollow: (follow) => set({ follow }),
  setScrubbing: (scrubbing) => set({ scrubbing }),
  openSessions: () => set({ sessionsOpen: true }),
  openSync: () => set({ syncOpen: true }),
  closeSync: () => set({ syncOpen: false }),
  setPeriods: (periods) => set({ periods }),
  // Written on every event, so it stays out of any selector a component uses
  // per frame: only the stall watcher reads it.
  noteEvent: (lastEventAt) => set({ lastEventAt }),
  setStalled: (stalled) => set({ stalled }),
  openSettings: () => set({ settingsOpen: true }),
  setGlance: (glance) => set({ glance }),

  setFollowLive: (followLive) =>
    set((s) => {
      persist({ ...s, followLive });
      // The server does the switching, so it has to be told as well.
      if (followLive) void post({ follow: 'auto' });
      return { followLive };
    }),

  setKeepAwake: (keepAwake) =>
    set((s) => {
      persist({ ...s, keepAwake });
      return { keepAwake };
    }),
  closeSettings: () => set({ settingsOpen: false }),

  setDelay: (delayS) =>
    set((s) => {
      // The server's own floor, so the two agree about what is possible.
      const clamped = Math.max(4, Math.min(180, Math.round(delayS * 10) / 10));
      const key = s.session?.key;
      if (key != null) persist({ ...s, delays: { ...s.delays, [String(key)]: clamped } });
      void post({ delayS: clamped });
      return key == null ? {} : { delays: { ...s.delays, [String(key)]: clamped } };
    }),

  closeSessions: () => set({ sessionsOpen: false }),

  // Both of these ask the server; the feed answers with a fresh hello.
  chooseSession: (key) => {
    set({ sessionsOpen: false });
    void post({ session: key });
  },
  replayFromStart: () => {
    void post({ mode: 'replay', playing: true });
  },

  openPicker: (picker) => set({ picker }),
  closePicker: () => set({ picker: null }),
  clearHistory: () => set({ history: [] }),
}));

/** For the scene and other non-React readers, which poll rather than subscribe. */
export const storeState = (): StoreState => useStore.getState();
