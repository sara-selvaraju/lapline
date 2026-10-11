// Per-phone preferences. Nothing here is sent to the server.
//
// Every access is wrapped: localStorage throws in a private window and can be
// blocked outright, and a viewer losing their preferences is far better than a
// blank screen.

export type GapMode = 'int' | 'gap';
export type CameraPreset = 'map' | 'tilt' | 'chase';

export interface Prefs {
  sel: number | null;
  gapMode: GapMode;
  /** Elevation exaggeration: street circuits are nearly flat. */
  zx: number;
  allLabels: boolean;
  camera: CameraPreset;
  /** docs/DESIGN.md: each detail layer is a preference, on by default. */
  showTurns: boolean;
  showSectors: boolean;
  showPitLane: boolean;
}

const KEY = 'lapline';

export const DEFAULT_PREFS: Prefs = {
  sel: null,
  gapMode: 'int',
  zx: 4,
  allLabels: false,
  camera: 'tilt',
  showTurns: true,
  showSectors: true,
  showPitLane: true,
};

export function loadPrefs(): Prefs {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '{}') as Partial<Prefs>;
    return {
      sel: typeof raw.sel === 'number' ? raw.sel : DEFAULT_PREFS.sel,
      gapMode: raw.gapMode === 'gap' ? 'gap' : DEFAULT_PREFS.gapMode,
      zx: typeof raw.zx === 'number' ? raw.zx : DEFAULT_PREFS.zx,
      allLabels: typeof raw.allLabels === 'boolean' ? raw.allLabels : DEFAULT_PREFS.allLabels,
      camera:
        raw.camera === 'map' || raw.camera === 'chase' || raw.camera === 'tilt'
          ? raw.camera
          : DEFAULT_PREFS.camera,
      showTurns: typeof raw.showTurns === 'boolean' ? raw.showTurns : DEFAULT_PREFS.showTurns,
      showSectors: typeof raw.showSectors === 'boolean' ? raw.showSectors : DEFAULT_PREFS.showSectors,
      showPitLane: typeof raw.showPitLane === 'boolean' ? raw.showPitLane : DEFAULT_PREFS.showPitLane,
    };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export function savePrefs(p: Prefs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* private browsing, or site data blocked */
  }
}
