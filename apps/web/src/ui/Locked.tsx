// Inside a live window without sponsor access.
//
// Built to design/artboards/Locked.dc.html. The point of the screen is the
// time: OpenF1 only serves a session's data to sponsors while it is running,
// and thirty minutes after it ends the same data is free. Saying when turns a
// dead end into a wait.

import { useStore } from '../store/store.js';
import { fmtFreeAt } from './format.js';

export function Locked(): React.JSX.Element {
  const status = useStore((s) => s.status);
  const session = useStore((s) => s.session);
  const sessions = useStore((s) => s.sessions);
  const openSettings = useStore((s) => s.openSettings);
  const chooseSession = useStore((s) => s.chooseSession);

  // The most recent finished session of this weekend, which is the thing
  // actually worth offering instead of the one that is locked.
  const alternative = sessions.find((s) => !s.live && s.key !== session?.key);

  return (
    <section className="locked" aria-label="Live data locked">
      <div className="locked-badge" aria-hidden="true">
        <svg width="28" height="28" viewBox="0 0 24 24">
          <rect x="5" y="11" width="14" height="10" rx="2" fill="none" stroke="currentColor" strokeWidth="2" />
          <path d="M8 11V8a4 4 0 0 1 8 0v3" fill="none" stroke="currentColor" strokeWidth="2" />
        </svg>
      </div>

      <h2>The session is live, but live data isn’t switched on</h2>
      <p className="locked-copy">
        OpenF1 only serves data during a session to sponsors. Without sponsor access, this session
        opens for free replay from <b>{fmtFreeAt(status?.freeAt)}</b>.
      </p>

      <div className="locked-actions">
        {alternative && (
          <button className="button-primary" onClick={() => chooseSession(alternative.key)}>
            Replay {alternative.name.toLowerCase()} instead
          </button>
        )}
        <button className="button-outline" onClick={openSettings}>
          Choose another session
        </button>
      </div>

      <details className="locked-how">
        <summary>How to turn on live data</summary>
        <p>
          Sponsor OpenF1 for €9.90 a month, then add the login to the server’s settings on Railway
          as OPENF1_USERNAME and OPENF1_PASSWORD. Live data starts within a minute.
        </p>
      </details>
    </section>
  );
}
