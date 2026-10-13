// The banner shown when the stream has gone quiet.
//
// Built to design/artboards/Reconnecting.dc.html. The screen keeps what it
// last knew rather than emptying: positions, order and gaps all stay, drawn
// faded, because last known positions are far more use than a blank track.

import { useEffect, useState } from 'react';
import { retryNow } from '../stream/sse.js';
import { useStore } from '../store/store.js';

export function Reconnecting(): React.JSX.Element | null {
  const stalled = useStore((s) => s.stalled);
  const lastEventAt = useStore((s) => s.lastEventAt);
  // Ticks once a second purely so the count reads true; nothing else re-renders.
  const [, bump] = useState(0);

  useEffect(() => {
    if (!stalled) return;
    const id = setInterval(() => bump((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [stalled]);

  if (!stalled) return null;
  const quietFor = lastEventAt == null ? 0 : Math.round((Date.now() - lastEventAt) / 1000);

  return (
    <div className="stale-banner" role="alert">
      <div className="stale-words">
        <span className="stale-head">No new data for {quietFor} s</span>
        <span className="stale-note">Showing the last known positions. Trying again every 3 s.</span>
      </div>
      <button className="stale-retry" onClick={retryNow}>
        Retry now
      </button>
    </div>
  );
}
