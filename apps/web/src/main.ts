// Entry point: start the scene, connect the stream, wire the controls.
//
// All DOM listeners live here, so no UI module needs to import another one back.
//
// Ported from reference/prototype/public/app.js.

import './style.css';
import { $ } from './dom.js';
import { camera, canvas, ndcFor, resetView, startScene } from './scene/scene.js';
import { cars, pickCarAt } from './scene/cars.js';
import { buildTrack } from './scene/track.js';
import { savePrefs, state } from './state.js';
import { post } from './stream/control.js';
import { connect, watchVisibility } from './stream/sse.js';
import { renderControls, SPEEDS } from './ui/controls.js';
import { select } from './ui/selection.js';
import { hasWakeLock, releaseWake, requestWake } from './ui/settings.js';
import { renderTele } from './ui/telemetry.js';
import { invalidateTower, renderTower, setGapToggleLabel } from './ui/tower.js';

startScene();

// ---------------- track view ----------------

// Tap to select, ignoring drags, which are camera moves.
let down: { x: number; y: number } | null = null;
canvas.addEventListener('pointerdown', (e) => (down = { x: e.clientX, y: e.clientY }));
canvas.addEventListener('pointerup', (e) => {
  if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 8) return;
  const n = pickCarAt(ndcFor(e), camera);
  if (n != null) select(n);
});

$('followBtn').addEventListener('click', () => {
  state.follow = !state.follow;
  $('followBtn').setAttribute('aria-pressed', String(state.follow));
});
$('resetBtn').addEventListener('click', () => {
  state.follow = false;
  $('followBtn').setAttribute('aria-pressed', 'false');
  resetView();
});

// ---------------- tower ----------------

$('rows').addEventListener('click', (e) => {
  const li = (e.target as HTMLElement).closest('.row');
  if (li) select(Number((li as HTMLElement).dataset.n));
});
$('gapToggle').addEventListener('click', () => {
  state.gapMode = state.gapMode === 'int' ? 'gap' : 'int';
  setGapToggleLabel();
  invalidateTower();
  renderTower();
  savePrefs();
});
setGapToggleLabel();

// ---------------- replay and live controls ----------------

$('playBtn').addEventListener('click', () => void post({ playing: !state.replay?.playing }));
$('speedBtn').addEventListener('click', () => {
  const i = SPEEDS.indexOf(state.replay?.speed ?? 1);
  void post({ speed: SPEEDS[(i + 1) % SPEEDS.length] });
});
$('scrub').addEventListener('input', () => (state.scrubbing = true));
$('scrub').addEventListener('change', () => {
  state.scrubbing = false;
  if (!state.replay) return;
  const { start, end } = state.replay;
  void post({ at: start + (Number($<HTMLInputElement>('scrub').value) / 1000) * (end - start) });
  state.history = [];
});
$('delayMinus').addEventListener('click', () => void post({ delayS: (state.live?.delayS ?? 10) - 5 }));
$('delayPlus').addEventListener('click', () => void post({ delayS: (state.live?.delayS ?? 10) + 5 }));
$('fromStartBtn').addEventListener('click', () => void post({ session: state.session?.key, mode: 'replay' }));
$('toLiveBtn').addEventListener('click', () => void post({ session: state.session?.key, mode: 'live' }));

// ---------------- settings ----------------

$('menuBtn').addEventListener('click', () => $<HTMLDialogElement>('menu').showModal());
$('sessSelect').addEventListener('change', () =>
  void post({ session: Number($<HTMLSelectElement>('sessSelect').value) }),
);
$('autoBtn').addEventListener('click', () => {
  void post({ follow: 'auto' });
  $<HTMLDialogElement>('menu').close();
});

$<HTMLInputElement>('zx').value = String(state.zx);
$('zxVal').textContent = `${state.zx}×`;
$('zx').addEventListener('input', () => {
  state.zx = Number($<HTMLInputElement>('zx').value);
  $('zxVal').textContent = `${state.zx}×`;
  buildTrack();
  // Heights change, so the slide a car is mid-way through no longer applies.
  for (const c of cars.values()) c.from = null;
  savePrefs();
});

$<HTMLInputElement>('allLabels').checked = state.allLabels;
$('allLabels').addEventListener('change', () => {
  state.allLabels = $<HTMLInputElement>('allLabels').checked;
  savePrefs();
});

$('wake').addEventListener('change', () => {
  if ($<HTMLInputElement>('wake').checked) void requestWake();
  else void releaseWake();
});
// iOS needs a user gesture before granting a wake lock.
document.addEventListener('pointerdown', () => !hasWakeLock() && void requestWake(), { once: true });

// ---------------- go ----------------

renderControls();
renderTele();
connect();
watchVisibility();
