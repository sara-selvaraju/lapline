// The selected car's telemetry panel and its 30-second speed trace.
//
// Ported from reference/prototype/public/app.js.

import { $ } from '../dom.js';
import { cars } from '../scene/cars.js';
import { state } from '../state.js';
import { fmtGap, fmtLap, tyreHtml } from './format.js';

export function renderTele(): void {
  const n = state.sel;
  const d = n != null ? state.drivers.get(n) : undefined;
  const r = n != null ? state.timingByN.get(n) : undefined;
  const tel = n != null ? cars.get(n)?.tel : undefined;

  $('tSwatch').style.background = d?.colour || 'var(--haze)';
  $('tPos').textContent = r?.p ? `P${r.p}` : '–';
  $('tCode').textContent = d ? d.code : 'Tap a car';
  $('tTeam').textContent = d ? d.team : '';
  $('tTyre').innerHTML = r ? tyreHtml(r.tyre, r.age) : '';
  $('tSpeed').textContent = String(tel?.sp ?? '–');
  $('tGear').textContent = tel?.gear ? String(tel.gear) : tel ? 'N' : '–';
  $('bThr').style.width = `${Math.max(0, Math.min(100, tel?.thr ?? 0))}%`;
  $('bBrk').style.width = `${tel?.brk ? Math.min(100, tel.brk) : 0}%`;
  $('bRpm').style.width = `${Math.min(100, ((tel?.rpm ?? 0) / 13000) * 100)}%`;
  $('tRpm').textContent = tel?.rpm ? tel.rpm.toLocaleString('en-AU') : '';
  $('tGap').textContent = r ? fmtGap(state.gapMode === 'int' ? r.int : r.gap, r.p) : '–';
  $('tLast').textContent = fmtLap(r?.last);
  $('tBest').textContent = fmtLap(r?.best);
  drawSpark();
}

export function drawSpark(): void {
  const c = $<HTMLCanvasElement>('spark');
  const w = c.clientWidth;
  const h = c.clientHeight;
  const dpr = Math.min(window.devicePixelRatio, 2);
  if (c.width !== Math.round(w * dpr)) {
    c.width = Math.round(w * dpr);
    c.height = Math.round(h * dpr);
  }
  const g = c.getContext('2d')!;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);

  const H = state.history;
  if (H.length < 2) return;
  const t1 = H.at(-1)![0];
  const t0 = t1 - 30_000;
  const X = (t: number): number => ((t - t0) / 30_000) * w;
  const maxV = 360;

  // Brake zones as red bands along the bottom, full throttle as a faint green one.
  for (let i = 1; i < H.length; i++) {
    const x0 = X(H[i - 1]![0]);
    const x1 = X(H[i]![0]);
    if ((H[i]![3] ?? 0) > 0) {
      g.fillStyle = 'rgba(229,56,59,.85)';
      g.fillRect(x0, h - 5, Math.max(1, x1 - x0), 5);
    } else if ((H[i]![2] ?? 0) > 90) {
      g.fillStyle = 'rgba(43,182,115,.45)';
      g.fillRect(x0, h - 3, Math.max(1, x1 - x0), 3);
    }
  }

  g.strokeStyle = '#F2EBDD';
  g.lineWidth = 1.75;
  g.lineJoin = 'round';
  g.beginPath();
  H.forEach((p, i) => {
    const x = X(p[0]);
    const y = h - 7 - ((p[1] ?? 0) / maxV) * (h - 9);
    if (i) g.lineTo(x, y);
    else g.moveTo(x, y);
  });
  g.stroke();

  g.fillStyle = '#8C9AB5';
  g.font = '12px "Barlow Semi Condensed", sans-serif';
  g.fillText('Speed, last 30 s', 2, 10);
}
