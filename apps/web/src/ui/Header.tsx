// Circuit, lap count, the live pill and the menu. 56px.

import { useStore } from '../store/store.js';

function LivePill(): React.JSX.Element | null {
  const mode = useStore((s) => s.mode);
  const delayS = useStore((s) => s.live?.delayS ?? null);
  const finished = useStore((s) => s.timing?.flag === 'CHEQUERED' && s.result != null);
  const openSync = useStore((s) => s.openSync);

  // Finished.dc.html replaces the pill with plain text: there is nothing live
  // about a race that is over, and nothing to sync to.
  if (finished) return <span className="finished-note">Race finished</span>;

  if (mode === 'live') {
    return (
      <button
        className="pill"
        aria-label={`Live, ${delayS ?? 10} seconds behind real time. Open sync.`}
        onClick={openSync}
      >
        <span className="pill-dot" aria-hidden="true" />
        <span className="pill-label">Live</span>
        <span className="pill-note">{delayS ?? 10} s behind</span>
      </button>
    );
  }
  const label = mode === 'replay' ? 'Replay' : mode === 'locked' ? 'Locked' : 'Loading';
  return (
    <span className="pill pill-static">
      <span className="pill-label">{label}</span>
    </span>
  );
}

export function Header(): React.JSX.Element {
  const session = useStore((s) => s.session);
  const lap = useStore((s) => s.timing?.lap ?? null);
  const finished = useStore((s) => s.timing?.flag === 'CHEQUERED' && s.result != null);
  // OpenF1 publishes no total-lap figure, so the artboard's "23/62" shows as
  // "23" until a source for the total turns up.
  const totalLaps = useStore((s) => s.timing?.totalLaps ?? null);

  return (
    <header className="header">
      <div className="header-title">
        <span className="circuit">{session ? session.circuit || session.country : 'Connecting'}</span>
        {lap != null &&
          (finished ? (
            // A finished race is a distance, not a position in one.
            <span className="lap">
              <b>{lap}</b> laps
            </span>
          ) : (
            <span className="lap">
              Lap <b>{lap}</b>
              {totalLaps != null && `/${totalLaps}`}
            </span>
          ))}
      </div>
      <div className="header-right">
        <LivePill />
        <button className="icon-button" aria-label="Settings">
          <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none" />
          </svg>
        </button>
      </div>
    </header>
  );
}
