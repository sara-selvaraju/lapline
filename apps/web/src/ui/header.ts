// The header, the flag band and the race control line.
//
// Ported from reference/prototype/public/app.js.

import type { TrackFlag } from '@lapline/shared';
import { $ } from '../dom.js';
import { state } from '../state.js';

const FLAG_LABEL: Partial<Record<TrackFlag, string>> = {
  YELLOW: 'Yellow flag',
  SC: 'Safety car',
  'SC ENDING': 'Safety car in this lap',
  VSC: 'Virtual safety car',
  'VSC ENDING': 'Virtual safety car ending',
  RED: 'Red flag',
  CHEQUERED: 'Chequered flag',
};

const MODE_LABEL: Record<string, string> = {
  live: 'Live',
  replay: 'Replay',
  locked: 'Locked',
  idle: 'Loading',
};

export function renderHeader(): void {
  const s = state.session;
  $('sessname').textContent = s ? `${s.circuit || s.country} ${s.name.toLowerCase()}` : 'No session';

  const lap = state.timing?.lap;
  $('lap').innerHTML = lap ? `Lap <b>${lap}</b>` : '';

  const flag = state.timing?.flag || 'GREEN';
  // The band keeps one class per state; 'ending' variants share their base colour.
  const base = flag.replace(' ENDING', '');
  const band = $('flagband');
  band.className = `flag-${base}`;
  band.textContent = FLAG_LABEL[flag as TrackFlag] || '';

  const b = $('modebadge');
  b.className = `badge ${state.mode === 'live' ? 'live' : ''}`;
  b.textContent = MODE_LABEL[state.mode] || '';
}

export function renderRc(): void {
  const m = state.timing?.rc?.[0];
  // Upstream shouts in capitals; sentence case reads better in a glance.
  const msg = m?.msg;
  $('rc').textContent = msg ? msg.charAt(0) + msg.slice(1).toLowerCase() : '';
  $('rc').title = msg || '';
}
