// "Sync with TV": work out how far behind real time the viewer's broadcast is.
//
// Built to design/artboards/SyncSheet.dc.html. The whole idea is one tap: the
// viewer watches their television, taps as the leader crosses the line, and
// the difference between that moment and the moment it really happened is the
// delay. The arithmetic lives on the server in derive/crossings.ts so it can
// be tested; this is the sheet around it.

import { useEffect, useState } from 'react';
import { useStore } from '../store/store.js';
import { fetchCrossings, type Crossings } from '../stream/queries.js';

/** How often the waiting state refreshes its "next crossing" estimate. */
const POLL_MS = 3000;

export function SyncSheet(): React.JSX.Element | null {
  const open = useStore((s) => s.syncOpen);
  const close = useStore((s) => s.closeSync);
  const delayS = useStore((s) => s.live?.delayS ?? 10);
  const setDelay = useStore((s) => s.setDelay);
  const drivers = useStore((s) => s.drivers);

  const [data, setData] = useState<Crossings | null>(null);
  const [marked, setMarked] = useState(false);

  useEffect(() => {
    if (!open) {
      setMarked(false);
      return;
    }
    let live = true;
    const tick = async (): Promise<void> => {
      const next = await fetchCrossings();
      if (live && next) setData(next);
    };
    void tick();
    const id = setInterval(() => void tick(), POLL_MS);
    return () => {
      live = false;
      clearInterval(id);
    };
  }, [open]);

  if (!open) return null;

  const leader = data?.next?.n ?? null;
  const code = leader == null ? 'the leader' : (drivers.get(leader)?.code ?? String(leader));

  /**
   * The tap. The time that matters is now, not when the response lands, so it
   * is taken before anything else happens.
   */
  const mark = (): void => {
    const tappedAt = Date.now();
    const times = data?.crossings ?? [];
    let last: number | null = null;
    for (const c of times) if (c <= tappedAt && (last == null || c > last)) last = c;
    if (last == null) return;
    setDelay((tappedAt - last) / 1000);
    setMarked(true);
  };

  return (
    <div className="sheet-scrim" onClick={close} role="presentation">
      <section
        className="sheet sync-sheet"
        role="dialog"
        aria-modal="true"
        aria-label="Sync with TV"
        onClick={(e) => e.stopPropagation()}
      >
        <span className="sheet-handle" aria-hidden="true" />
        <div className="sheet-head">
          <h2>Sync with TV</h2>
          <button className="sheet-done" onClick={close}>
            Done
          </button>
        </div>

        {marked ? (
          <div className="sync-body">
            <p className="sync-delay">
              <span className="sync-delay-value">{delayS} s</span>
              <span className="sync-delay-unit">behind real time</span>
            </p>
            <p className="sync-copy">
              Cars on Lapline now move with the TV. Fine-tune if they look early or late.
            </p>
            <div className="sync-tune" role="group" aria-label="Fine-tune delay">
              {[-5, -1, 1, 5].map((step) => (
                <button key={step} onClick={() => setDelay(delayS + step)}>
                  {step < 0 ? '−' : '+'}
                  {Math.abs(step)} s
                </button>
              ))}
            </div>
            <button className="sync-again" onClick={() => setMarked(false)}>
              Mark the line again
            </button>
          </div>
        ) : (
          <div className="sync-body">
            <p className="sync-copy">
              Watch the TV. Tap the button at the moment the leader, <b>{code}</b>, crosses the
              start/finish line. Lapline works out how far behind real time your broadcast is.
            </p>
            <button className="sync-mark" onClick={mark} disabled={!data?.crossings.length}>
              {code} crossed the line
            </button>
            <p className="sync-note">{waitingNote(code, data)}</p>
          </div>
        )}

        <p className="sync-foot">
          Your sync is remembered for this session on this phone. Data from OpenF1 itself arrives
          about 3 s after real time, so delays under 4 s aren’t possible.
        </p>
      </section>
    </div>
  );
}

/** Where the leader is, in the words the artboard uses. Both are estimates. */
function waitingNote(code: string, data: Crossings | null): string {
  if (!data?.next) return 'Waiting for the leader’s position.';
  const { metres, at } = data.next;
  const parts: string[] = [];
  if (metres != null) {
    parts.push(
      metres >= 1000
        ? `${code} is about ${(metres / 1000).toFixed(1)} km from the line`
        : `${code} is about ${metres} m from the line`,
    );
  }
  if (at != null) {
    const seconds = Math.max(0, Math.round((at - data.t) / 1000));
    parts.push(`next crossing in roughly ${seconds} s`);
  }
  return parts.length ? `${parts.join(', ')}.` : 'Waiting for the leader’s position.';
}
