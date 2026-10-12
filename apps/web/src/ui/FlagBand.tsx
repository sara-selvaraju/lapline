// The track flag. Always visible: 4px of green when nothing is happening, and
// 28px carrying a label in every other state. docs/DESIGN.md: it changes height
// and colour over 200-300ms, and nothing else on screen moves.

import type { TrackFlag } from '@lapline/shared';
import { useStore } from '../store/store.js';

const LABEL: Partial<Record<TrackFlag, string>> = {
  YELLOW: 'Yellow flag',
  SC: 'Safety car',
  'SC ENDING': 'Safety car in this lap',
  VSC: 'Virtual safety car',
  'VSC ENDING': 'Virtual safety car ending',
  RED: 'Red flag, session suspended',
  CHEQUERED: 'Chequered flag',
};

/** Which states carry the warning triangle, as the safety car artboard draws it. */
const WARNS: TrackFlag[] = ['YELLOW', 'SC', 'SC ENDING', 'VSC', 'VSC ENDING'];

function Warning(): React.JSX.Element {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" className="flag-icon">
      <path
        d="M12 3L22 20H2z"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path d="M12 10v4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <circle cx="12" cy="17.2" r="1.1" fill="currentColor" />
    </svg>
  );
}

function RedFlagMark(): React.JSX.Element {
  return (
    <svg width="14" height="16" viewBox="0 0 14 16" aria-hidden="true" className="flag-icon">
      <path d="M2 1v14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M3 2h9l-2.2 3.2L12 8.5H3z" fill="currentColor" />
    </svg>
  );
}

export function FlagBand(): React.JSX.Element {
  const flag = useStore((s) => s.timing?.flag ?? 'GREEN');
  const sinceLap = useStore((s) => s.timing?.flagSinceLap ?? null);

  // The safety car band names the lap it came out on, which is the one piece
  // of the label the flag itself cannot supply.
  const suffix = (flag === 'SC' || flag === 'VSC') && sinceLap != null ? ` since lap ${sinceLap}` : '';
  const label = LABEL[flag] ? `${LABEL[flag]}${suffix}` : undefined;

  // The 'ending' variants share their base colour and differ by label, which
  // is what docs/DESIGN.md asks for; no artboard draws them.
  const base = flag.replace(' ENDING', '').toLowerCase().replace(' ', '-');

  return (
    <div
      className={`flag-band flag-${base}`}
      data-labelled={label ? 'true' : 'false'}
      role="status"
      aria-label={label ?? 'Track green'}
    >
      {flag === 'CHEQUERED' && <span className="chequer" aria-hidden="true" />}
      {WARNS.includes(flag) && <Warning />}
      {flag === 'RED' && <RedFlagMark />}
      {label}
      {flag === 'CHEQUERED' && <span className="chequer" aria-hidden="true" />}
    </div>
  );
}
