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

export function Header(): React.JSX.Element | null {
  const session = useStore((s) => s.session);
  const openSettings = useStore((s) => s.openSettings);
  const glance = useStore((s) => s.glance);
  const setGlance = useStore((s) => s.setGlance);
  const lap = useStore((s) => s.timing?.lap ?? null);
  const finished = useStore((s) => s.timing?.flag === 'CHEQUERED' && s.result != null);
  // OpenF1 publishes no total-lap figure, so the artboard's "23/62" shows as
  // "23" until a source for the total turns up.
  const totalLaps = useStore((s) => s.timing?.totalLaps ?? null);

  // Glance shows the race and nothing else: no circuit name, no pill, no
  // settings. Its own corner carries the only two things left. After the
  // hooks, not before: an early return above them changes how many run.
  if (glance) return null;

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
        {/* docs/DESIGN.md asked how glance mode is entered and suggested a
            control in landscape. This is it, carrying the expand icon that
            mirrors the contract icon the glance artboard uses to leave. CSS
            shows it only in landscape, where glance mode lives. */}
        <button className="icon-button glance-enter" aria-label="Glance mode" onClick={() => setGlance(true)}>
          <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"
              stroke="currentColor"
              strokeWidth="2"
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        <button className="icon-button" aria-label="Settings" onClick={openSettings}>
          <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none" />
          </svg>
        </button>
      </div>
    </header>
  );
}
