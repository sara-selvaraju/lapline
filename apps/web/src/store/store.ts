// The one store. Fed only by the SSE client; components subscribe to slices.
//
// Ticks live here too, at 4 Hz. That is safe because Zustand only re-renders a
// component when the slice it selected changes: the scene reads the tick
// straight off the store each frame without React involvement, and the one
// component that does show per-frame values — the driver strip — is small.
// Do not select the whole state anywhere.

import { create } from 'zustand';
import type { Circuit, Driver, Hello, LiveMeta, ReplayMeta, Status, Tick, Timing, TowerRow, Transform } from '@lapline/shared';
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
  follow: boolean;
  scrubbing: boolean;
  /** Driver numbers under the last ambiguous tap, or null when closed. */
  picker: number[] | null;
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
  setGapMode: (m: GapMode) => void;
  setZx: (zx: number) => void;
  setAllLabels: (on: boolean) => void;
  setCamera: (p: CameraPreset) => void;
  setLayer: (layer: 'showTurns' | 'showSectors' | 'showPitLane', on: boolean) => void;
  setFollow: (on: boolean) => void;
  setScrubbing: (on: boolean) => void;
  openPicker: (ns: number[]) => void;
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
  follow: false,
  scrubbing: false,
  picker: null,
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
        if (car) {
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
  openPicker: (picker) => set({ picker }),
  closePicker: () => set({ picker: null }),
  clearHistory: () => set({ history: [] }),
}));

/** For the scene and other non-React readers, which poll rather than subscribe. */
export const storeState = (): StoreState => useStore.getState();
