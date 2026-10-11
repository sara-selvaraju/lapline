// The timing tower.
//
// The whole list is rebuilt as one string and only written when it changed,
// because touching the DOM every second visibly costs frames on a phone.
//
// Ported from reference/prototype/public/app.js.

import { $ } from '../dom.js';
import { state } from '../state.js';
import { esc, fmtGap, fmtLap, tyreHtml } from './format.js';

let towerKey = '';

/** Forces the next render to write, after something outside the rows changed. */
export function invalidateTower(): void {
  towerKey = '';
}

export function renderTower(): void {
  const rows = state.timing?.rows || [];
  const bestOverall = Math.min(...rows.map((r) => r.best ?? Infinity));

  const html = rows
    .map((r) => {
      const d = state.drivers.get(r.n) || { code: String(r.n), colour: '#8C9AB5' };
      const gap = state.gapMode === 'int' ? fmtGap(r.int, r.p) : fmtGap(r.gap, r.p);
      const pb = r.last != null && r.last === r.best;
      return `<li class="row ${r.n === state.sel ? 'sel' : ''}" data-n="${r.n}">
        <span class="p">${r.p ?? ''}</span>
        <span class="c" style="background:${esc(d.colour)}"></span>
        <span class="code">${esc(d.code)}${r.pit ? '<span class="pit">Pit</span>' : ''}</span>
        <span class="gap">${esc(gap)}</span>
        <span class="tyrecell">${tyreHtml(r.tyre, r.age)}</span>
        <span class="last ${pb ? 'pb' : ''}" style="${
          r.last != null && r.last === bestOverall ? 'color:var(--purple)' : ''
        }">${fmtLap(r.last)}</span>
      </li>`;
    })
    .join('');

  if (html !== towerKey) {
    $('rows').innerHTML = html;
    towerKey = html;
  }
}

export function setGapToggleLabel(): void {
  $('gapToggle').textContent = state.gapMode === 'int' ? 'Interval' : 'To leader';
}
