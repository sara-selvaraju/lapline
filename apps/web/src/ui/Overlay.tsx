// The message over the track: locked, an error, or waiting for cars. The full
// state screens — loading, reconnecting, locked — are M7; this is the one line
// the prototype showed, kept so those states are not silently invisible.

import { useStore } from '../store/store.js';
import { fmtWhen } from './format.js';

export function Overlay(): React.JSX.Element | null {
  const mode = useStore((s) => s.mode);
  const status = useStore((s) => s.status);
  const hasCars = useStore((s) => (s.tick?.cars.length ?? 0) > 0);

  let msg = '';
  if (mode === 'locked') {
    msg = `${(status?.text || 'Live data is locked').replace(/\.$/, '')}.`;
    if (status?.freeAt) msg += ` This session can be replayed for free from ${fmtWhen(status.freeAt)}.`;
    msg += ' Open settings to pick a finished session.';
  } else if (status?.level === 'error') {
    msg = status.text;
  } else if (!hasCars) {
    msg =
      status?.text && status.level !== 'ok'
        ? `${status.text}…`
        : mode === 'live'
          ? 'Waiting for cars on track…'
          : 'Loading car positions…';
  }

  if (!msg) return null;
  return (
    <div className="overlay" role="status">
      <p>{msg}</p>
    </div>
  );
}
