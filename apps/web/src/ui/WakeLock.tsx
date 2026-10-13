// Holding the screen awake while the app is in front.
//
// A viewer glancing at a phone propped beside a television should not have to
// keep waking it. The lock is dropped whenever the page is hidden — the
// browser insists — so it is retaken on the way back.

import { useEffect } from 'react';
import { useStore } from '../store/store.js';

type Sentinel = { release(): Promise<void> };
type WakeLockNavigator = Navigator & { wakeLock?: { request(type: 'screen'): Promise<Sentinel> } };

export function WakeLock(): null {
  const keepAwake = useStore((s) => s.keepAwake);

  useEffect(() => {
    const api = (navigator as WakeLockNavigator).wakeLock;
    if (!keepAwake || !api) return;

    let sentinel: Sentinel | null = null;
    let live = true;

    const take = async (): Promise<void> => {
      if (document.visibilityState !== 'visible') return;
      try {
        const next = await api.request('screen');
        if (live) sentinel = next;
        else void next.release();
      } catch {
        // Refused — low battery, or the browser simply says no. Nothing to do.
      }
    };

    void take();
    document.addEventListener('visibilitychange', () => void take());
    return () => {
      live = false;
      void sentinel?.release();
      sentinel = null;
    };
  }, [keepAwake]);

  return null;
}
