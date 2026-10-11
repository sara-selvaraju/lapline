// Selecting a car. Clearing the history matters: the speed trace belongs to one
// driver, so carrying it over would draw a line that never happened.
//
// Ported from reference/prototype/public/app.js.

import { savePrefs, state } from '../state.js';
import { renderTele } from './telemetry.js';
import { invalidateTower, renderTower } from './tower.js';

export function select(n: number, persist = true): void {
  if (state.sel !== n) state.history = [];
  state.sel = n;
  invalidateTower();
  renderTower();
  renderTele();
  if (persist) savePrefs();
}
