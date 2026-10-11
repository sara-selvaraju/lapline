// The replay and live control bars.
//
// Ported from reference/prototype/public/app.js.

import { $ } from '../dom.js';
import { storeState } from '../store/store.js';

const PLAY = '<path d="M7 5v14l12-7z" fill="currentColor"/>';
const PAUSE = '<path d="M6 5h4v14H6zM14 5h4v14h-4z" fill="currentColor"/>';

export const SPEEDS = [1, 2, 4, 8, 16];

export function renderControls(): void {
  const isReplay = storeState().mode === 'replay';
  const isLive = storeState().mode === 'live';
  $('replayCtl').hidden = !isReplay;
  $('liveCtl').hidden = !isLive;
  $('controls').hidden = !isReplay && !isLive;
  // "Go live" only makes sense when this session is live and we could read it.
  const sessLive = storeState().sessions.find((s: { key: number; live: boolean }) => s.key === storeState().session?.key)?.live;
  $('toLiveBtn').hidden = !(isReplay && sessLive && storeState().canLive);
  renderClock();
}

export function renderClock(): void {
  const s = storeState();
  if (s.mode === 'replay' && s.replay && s.tick) {
    const { start, end, playing, speed } = s.replay;
    const el = Math.max(0, s.tick.t - start) / 1000;
    const h = Math.floor(el / 3600);
    const m = Math.floor((el % 3600) / 60);
    const sec = Math.floor(el % 60);
    $('clock').textContent = `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
    if (!s.scrubbing) {
      $<HTMLInputElement>('scrub').value = String(Math.round(((s.tick.t - start) / (end - start)) * 1000));
    }
    $('playIcon').innerHTML = playing ? PAUSE : PLAY;
    $('playBtn').setAttribute('aria-label', playing ? 'Pause' : 'Play');
    $('speedBtn').textContent = `${speed}\u00d7`;
  }
  if (s.mode === 'live' && s.live) $('delayVal').textContent = String(s.live.delayS);
}
