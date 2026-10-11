// The client's state, and the preferences that survive a reload.
//
// M0 keeps the prototype's plain object; M1 replaces it with a Zustand store fed
// by the SSE client. Every localStorage access is wrapped, because it throws in
// a private window and returns nothing in a few embedded browsers.
//
// Ported from reference/prototype/public/app.js.

import type { Driver, InitPayload, LiveMeta, ReplayMeta, StatusPayload, TimingBlock, Tick, TrackPayload } from '@lapline/shared';

export type GapMode = 'int' | 'gap';

/** One sample of the selected car, for the 30-second speed trace. */
export type HistorySample = [t: number, speed: number | null, throttle: number | null, brake: number | null];

export interface Prefs {
  sel?: number | null;
  gapMode?: GapMode;
  zx?: number;
  allLabels?: boolean;
}

export interface State {
  session: InitPayload['session'];
  mode: string;
  drivers: Map<number, Driver>;
  sessions: InitPayload['sessions'];
  track: TrackPayload | null;
  transform: TrackPayload['transform'] | null;
  sel: number | null;
  gapMode: GapMode;
  /** Elevation exaggeration: street circuits are nearly flat. */
  zx: number;
  allLabels: boolean;
  follow: boolean;
  timing: TimingBlock | null;
  timingByN: Map<number, TimingBlock['rows'][number]>;
  lastTick: Tick | null;
  history: HistorySample[];
  replay: ReplayMeta | null;
  live: LiveMeta | null;
  status: StatusPayload | null;
  canLive: boolean;
  scrubbing: boolean;
}

const PREFS_KEY = 'lapline';

export function loadPrefs(): Prefs {
  try {
    return JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') as Prefs;
  } catch {
    return {};
  }
}

const prefs = loadPrefs();

export const state: State = {
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

export function savePrefs(): void {
  try {
    localStorage.setItem(
      PREFS_KEY,
      JSON.stringify({
        sel: state.sel,
        gapMode: state.gapMode,
        zx: state.zx,
        allLabels: state.allLabels,
      } satisfies Prefs),
    );
  } catch {
    /* private browsing, or site data blocked */
  }
}
