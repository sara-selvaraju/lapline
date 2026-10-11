// The replay and live control bars.
//
// Ported from reference/prototype/public/app.js.

import { $ } from '../dom.js';
import { state } from '../state.js';

const PLAY = '<path d="M7 5v14l12-7z" fill="currentColor"/>';
const PAUSE = '<path d="M6 5h4v14H6zM14 5h4v14h-4z" fill="currentColor"/>';

export const SPEEDS = [1, 2, 4, 8, 16];

export function renderControls(): void {
  const isReplay = state.mode === 'replay';
  const isLive = state.mode === 'live';
  $('replayCtl').hidden = !isReplay;
  $('liveCtl').hidden = !isLive;
  $('controls').hidden = !isReplay && !isLive;
  // "Go live" only makes sense when this session is live and we could read it.
  const sessLive = state.sessions.find((s) => s.key === state.session?.key)?.live;
  $('toLiveBtn').hidden = !(isReplay && sessLive && state.canLive);
  renderClock();
}

export function renderClock(): void {
  if (state.mode === 'replay' && state.replay && state.lastTick) {
    const { start, end, playing, speed } = state.replay;
    const el = Math.max(0, state.lastTick.t - start) / 1000;
    const h = Math.floor(el / 3600);
    const m = Math.floor((el % 3600) / 60);
    const s = Math.floor(el % 60);
    $('clock').textContent = `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    if (!state.scrubbing) {
      $<HTMLInputElement>('scrub').value = String(Math.round(((state.lastTick.t - start) / (end - start)) * 1000));
    }
    $('playIcon').innerHTML = playing ? PAUSE : PLAY;
    $('playBtn').setAttribute('aria-label', playing ? 'Pause' : 'Play');
    $('speedBtn').textContent = `${speed}×`;
  }
  if (state.mode === 'live' && state.live) $('delayVal').textContent = String(state.live.delayS);
}
