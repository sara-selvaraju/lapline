// What the viewer needs to know while a session is suspended.
//
// RedFlag.dc.html puts a card over the track with the time it stopped, why,
// and the lap the order was frozen at. The time and the lap are derived; the
// reason is race control's own words, because no feed publishes a restart
// reason and inventing one would be worse than saying nothing.

import { useStore } from '../store/store.js';
import { sentenceCase } from './format.js';

export function RedFlagCard(): React.JSX.Element | null {
  const flag = useStore((s) => s.timing?.flag ?? 'GREEN');
  const since = useStore((s) => s.timing?.flagSince ?? null);
  const sinceLap = useStore((s) => s.timing?.flagSinceLap ?? null);
  const rc = useStore((s) => s.timing?.rc);

  if (flag !== 'RED') return null;

  // The message that came with the stoppage, which is the nearest thing to a
  // reason anyone publishes.
  const reason = rc?.find((line) => /RED FLAG|SUSPEND|INCIDENT/i.test(line.msg))?.msg ?? rc?.[0]?.msg ?? '';
  const at = since == null ? null : new Date(since);

  return (
    <aside className="red-card" aria-label="Session suspended">
      {at && (
        <span className="red-card-when">
          Suspended {at.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' })}
        </span>
      )}
      {reason && <span className="red-card-why">{sentenceCase(reason)}</span>}
      {sinceLap != null && <span className="red-card-frozen">Order frozen at the end of lap {sinceLap}</span>}
    </aside>
  );
}
