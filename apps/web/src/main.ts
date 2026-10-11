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
import { storeState, useStore } from './store/store.js';
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
  const next = !storeState().follow;
  useStore.getState().setFollow(next);
  $('followBtn').setAttribute('aria-pressed', String(next));
});
$('resetBtn').addEventListener('click', () => {
  useStore.getState().setFollow(false);
  $('followBtn').setAttribute('aria-pressed', 'false');
  resetView();
});

// ---------------- tower ----------------

$('rows').addEventListener('click', (e) => {
  const li = (e.target as HTMLElement).closest('.row');
  if (li) select(Number((li as HTMLElement).dataset.n));
});
$('gapToggle').addEventListener('click', () => {
  useStore.getState().setGapMode(storeState().gapMode === 'int' ? 'gap' : 'int');
  setGapToggleLabel();
  invalidateTower();
  renderTower();
});
setGapToggleLabel();

// ---------------- replay and live controls ----------------

$('playBtn').addEventListener('click', () => void post({ playing: !storeState().replay?.playing }));
$('speedBtn').addEventListener('click', () => {
  const i = SPEEDS.indexOf(storeState().replay?.speed ?? 1);
  void post({ speed: SPEEDS[(i + 1) % SPEEDS.length] });
});
$('scrub').addEventListener('input', () => useStore.getState().setScrubbing(true));
$('scrub').addEventListener('change', () => {
  useStore.getState().setScrubbing(false);
  const replay = storeState().replay;
  if (!replay) return;
  const { start, end } = replay;
  void post({ at: start + (Number($<HTMLInputElement>('scrub').value) / 1000) * (end - start) });
  useStore.getState().clearHistory();
});
$('delayMinus').addEventListener('click', () => void post({ delayS: (storeState().live?.delayS ?? 10) - 5 }));
$('delayPlus').addEventListener('click', () => void post({ delayS: (storeState().live?.delayS ?? 10) + 5 }));
$('fromStartBtn').addEventListener('click', () => void post({ session: storeState().session?.key, mode: 'replay' }));
$('toLiveBtn').addEventListener('click', () => void post({ session: storeState().session?.key, mode: 'live' }));

// ---------------- settings ----------------

$('menuBtn').addEventListener('click', () => $<HTMLDialogElement>('menu').showModal());
$('sessSelect').addEventListener('change', () =>
  void post({ session: Number($<HTMLSelectElement>('sessSelect').value) }),
);
$('autoBtn').addEventListener('click', () => {
  void post({ follow: 'auto' });
  $<HTMLDialogElement>('menu').close();
});

$<HTMLInputElement>('zx').value = String(storeState().zx);
$('zxVal').textContent = `${storeState().zx}×`;
$('zx').addEventListener('input', () => {
  useStore.getState().setZx(Number($<HTMLInputElement>('zx').value));
  $('zxVal').textContent = `${storeState().zx}×`;
  buildTrack();
  // Heights change, so the slide a car is mid-way through no longer applies.
  for (const c of cars.values()) c.from = null;
});

$<HTMLInputElement>('allLabels').checked = storeState().allLabels;
$('allLabels').addEventListener('change', () => {
  useStore.getState().setAllLabels($<HTMLInputElement>('allLabels').checked);
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
