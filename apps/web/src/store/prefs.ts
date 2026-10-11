// Per-phone preferences. Nothing here is sent to the server.
//
// Every access is wrapped: localStorage throws in a private window and can be
// blocked outright, and a viewer losing their preferences is far better than a
// blank screen.

export type GapMode = 'int' | 'gap';

export interface Prefs {
  sel: number | null;
  gapMode: GapMode;
  /** Elevation exaggeration: street circuits are nearly flat. */
  zx: number;
  allLabels: boolean;
}

const KEY = 'lapline';

export const DEFAULT_PREFS: Prefs = { sel: null, gapMode: 'int', zx: 4, allLabels: false };

export function loadPrefs(): Prefs {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '{}') as Partial<Prefs>;
    return {
      sel: typeof raw.sel === 'number' ? raw.sel : DEFAULT_PREFS.sel,
      gapMode: raw.gapMode === 'gap' ? 'gap' : DEFAULT_PREFS.gapMode,
      zx: typeof raw.zx === 'number' ? raw.zx : DEFAULT_PREFS.zx,
      allLabels: typeof raw.allLabels === 'boolean' ? raw.allLabels : DEFAULT_PREFS.allLabels,
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
