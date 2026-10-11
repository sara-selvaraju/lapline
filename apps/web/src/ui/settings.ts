// The settings sheet: session picker, elevation, labels and the wake lock.
//
// Ported from reference/prototype/public/app.js.

import { $ } from '../dom.js';
import { state } from '../state.js';
import { esc } from './format.js';

export function renderSessionSelect(): void {
  $('sessSelect').innerHTML = state.sessions
    .map((s) => {
      const when = new Date(s.start).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });
      return `<option value="${s.key}" ${state.session?.key === s.key ? 'selected' : ''}>${esc(
        s.label,
      )}, ${when}${s.live ? ' (live)' : ''}</option>`;
    })
    .join('');
}

export function renderStatusText(): void {
  const s = state.status;
  if (!s) return;
  const n = s.api?.requests ?? 0;
  const free = s.freeAt ? ` Free to replay from ${new Date(s.freeAt).toLocaleString('en-AU', { weekday: 'short', hour: 'numeric', minute: '2-digit' })}.` : '';
  $('statusText').textContent =
    `${s.text.replace(/\.$/, '')}.${free} Using OpenF1 ${s.api?.authed ? 'sponsor' : 'free'} access, ` +
    `${n} ${n === 1 ? 'request' : 'requests'} so far.`;
}

// Keep the phone awake while watching. Requires a user gesture on iOS, so the
// first pointer event asks for it.
let wakeLock: WakeLockSentinel | null = null;

export async function requestWake(): Promise<void> {
  if (!$<HTMLInputElement>('wake').checked || !('wakeLock' in navigator) || document.visibilityState !== 'visible') {
    return;
  }
  try {
    wakeLock = await navigator.wakeLock.request('screen');
  } catch {
    /* denied, or not permitted in this context */
  }
}

export function hasWakeLock(): boolean {
  return wakeLock !== null;
}

export async function releaseWake(): Promise<void> {
  if (wakeLock) {
    await wakeLock.release();
    wakeLock = null;
  }
}
