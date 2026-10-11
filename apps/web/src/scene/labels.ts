// Which cars carry a label, and keeping those labels off each other.
//
// docs/DESIGN.md: the leader, the selected car, and cars within 1.0 s of the
// selected car. The "label every car" setting overrides it. Labels avoid each
// other in screen space.

import type { TowerRow } from '@lapline/shared';

/** Cars within this of the selected car are labelled too. */
export const LABEL_WINDOW_S = 1.0;

/** A row's gap to the leader, as a number, or null when upstream sent text. */
function gapToLeader(row: TowerRow | undefined): number | null {
  if (!row) return null;
  if (row.p === 1) return 0;
  return typeof row.gap === 'number' ? row.gap : null;
}

/**
 * The drivers whose labels should be drawn.
 *
 * Proximity is judged on the gap to the leader, which is the only figure every
 * row shares; a lapped car sends text instead of a number and simply does not
 * qualify, which is right — it is nowhere near.
 */
export function labelledDrivers(
  rows: readonly TowerRow[],
  selected: number | null,
  allLabels: boolean,
): Set<number> {
  if (allLabels) return new Set(rows.map((r) => r.n));

  const out = new Set<number>();
  const leader = rows.find((r) => r.p === 1);
  if (leader) out.add(leader.n);
  if (selected != null) out.add(selected);

  const selGap = gapToLeader(rows.find((r) => r.n === selected));
  if (selGap != null) {
    for (const r of rows) {
      const g = gapToLeader(r);
      if (g != null && Math.abs(g - selGap) < LABEL_WINDOW_S) out.add(r.n);
    }
  }
  return out;
}

export interface LabelBox {
  n: number;
  /** Screen position of the label's centre, in CSS pixels. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Lower sorts first and keeps its place; others move around it. */
  priority: number;
}

/**
 * Pushes overlapping labels apart vertically and returns the offset each one
 * needs, in pixels. Greedy and single-pass: with at most a handful of labels
 * visible this is cheaper and steadier than anything cleverer, and a label that
 * jitters between frames is worse than one slightly out of place.
 */
export interface Obstacle {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export function resolveCollisions(
  boxes: readonly LabelBox[],
  gap = 2,
  obstacles: readonly Obstacle[] = [],
): Map<number, number> {
  const offsets = new Map<number, number>();
  // Fixed furniture the labels must avoid, such as the camera group.
  const placed: Obstacle[] = [...obstacles];

  for (const b of [...boxes].sort((a, c) => a.priority - c.priority || a.y - c.y)) {
    let dy = 0;
    // Walk upwards until this box clears everything already placed.
    for (let guard = 0; guard < 24; guard++) {
      const top = b.y - b.height / 2 + dy;
      const bottom = b.y + b.height / 2 + dy;
      const left = b.x - b.width / 2;
      const right = b.x + b.width / 2;
      const hit = placed.find((p) => right > p.left && left < p.right && bottom > p.top && top < p.bottom);
      if (!hit) {
        placed.push({ top, bottom, left, right });
        break;
      }
      dy -= hit.bottom - top + gap;
    }
    offsets.set(b.n, dy);
  }
  return offsets;
}
