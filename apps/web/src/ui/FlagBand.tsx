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
  RED: 'Red flag',
  CHEQUERED: 'Chequered flag',
};

export function FlagBand(): React.JSX.Element {
  const flag = useStore((s) => s.timing?.flag ?? 'GREEN');
  const label = LABEL[flag];
  // The 'ending' variants share their base colour.
  const base = flag.replace(' ENDING', '').toLowerCase().replace(' ', '-');
  return (
    <div className={`flag-band flag-${base}`} data-labelled={label ? 'true' : 'false'} role="status" aria-label={label ?? 'Track green'}>
      {label}
    </div>
  );
}
