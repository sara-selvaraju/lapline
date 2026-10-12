// A list of the weekend's sessions, opened from the finished screen.
//
// Deliberately small. docs/BUILD-PLAN.md M7 brings the settings sheet this
// belongs in, grouped by weekend with the rest of the preferences; this is
// the least that makes "Choose a session" on Finished.dc.html do something.

import { useStore } from '../store/store.js';
import { fmtWhen } from './format.js';

export function SessionPicker(): React.JSX.Element | null {
  const open = useStore((s) => s.sessionsOpen);
  const sessions = useStore((s) => s.sessions);
  const current = useStore((s) => s.session?.key ?? null);
  const close = useStore((s) => s.closeSessions);
  const choose = useStore((s) => s.chooseSession);

  if (!open) return null;

  return (
    <div className="sheet-scrim picker-scrim" onClick={close} role="presentation">
      <div
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-label="Choose a session"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sheet-head">
          <h2>Choose a session</h2>
          <button className="icon-button" aria-label="Close" onClick={close}>
            <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <ol className="session-list">
          {sessions.map((s) => (
            <li key={s.key}>
              <button
                className={`session-row${s.key === current ? ' is-current' : ''}`}
                onClick={() => choose(s.key)}
              >
                <span className="session-label">{s.label}</span>
                <span className="session-when">{s.live ? 'Live now' : fmtWhen(s.start)}</span>
              </button>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
