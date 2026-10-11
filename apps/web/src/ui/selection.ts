// Selecting a car. The store owns the rule that the speed trace resets, because
// the trace belongs to one driver.

import { useStore } from '../store/store.js';
import { renderTele } from './telemetry.js';
import { invalidateTower, renderTower } from './tower.js';

export function select(n: number, persist = true): void {
  useStore.getState().select(n, persist);
  invalidateTower();
  renderTower();
  renderTele();
}
