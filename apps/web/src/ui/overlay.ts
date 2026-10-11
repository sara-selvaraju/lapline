// The message over the track view: locked, an error, or waiting for cars.
//
// Ported from reference/prototype/public/app.js.

import { $ } from '../dom.js';
import { state } from '../state.js';
import { esc, fmtWhen } from './format.js';

export function renderOverlay(): void {
  const o = $('overlay');
  const s = state.status;
  let msg = '';

  if (state.mode === 'locked') {
    msg = `${(s?.text || 'Live data is locked').replace(/\.$/, '')}.`;
    if (s?.freeAt) msg += ` This session can be replayed for free from ${fmtWhen(s.freeAt)}.`;
    msg += ' Open settings to pick a finished session.';
  } else if (s?.level === 'error') {
    msg = s.text;
  } else if (!state.lastTick || !state.lastTick.cars.length) {
    msg =
      s?.text && s.level !== 'ok'
        ? `${s.text}…`
        : state.mode === 'live'
          ? 'Waiting for cars on track…'
          : 'Loading car positions…';
  }

  o.hidden = !msg;
  o.innerHTML = msg ? `<p>${esc(msg)}</p>` : '';
}
