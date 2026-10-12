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
  /** Whether the telemetry panel is open, kept across sessions. */
  expanded: boolean;
  /**
   * The sync delay, in seconds, remembered per session key.
   *
   * Per session because a broadcast's delay is a property of that broadcast,
   * and per phone because that is where the television is. The server still
   * holds one delay for the feed, so two phones watching the same session
   * means whoever synced last moves both views.
   */
  delays: Record<string, number>;
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
  expanded: false,
  delays: {},
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
      expanded: typeof raw.expanded === 'boolean' ? raw.expanded : DEFAULT_PREFS.expanded,
      delays: readDelays(raw.delays),
    };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

/**
 * The remembered delays, keeping only what makes sense.
 *
 * The first keyed value in here, so it gets the same treatment every scalar
 * does: nothing from storage is spread in, each entry is checked, and a key
 * that is not a session number or a delay outside the range the server will
 * accept is simply dropped.
 */
function readDelays(raw: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!/^\d+$/.test(key)) continue;
    if (typeof value !== 'number' || !Number.isFinite(value)) continue;
    if (value < 4 || value > 180) continue;
    out[key] = value;
  }
  return out;
}

export function savePrefs(p: Prefs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* private browsing, or site data blocked */
  }
}
