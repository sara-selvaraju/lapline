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

/**
 * How much clear space a label needs above and below its natural place before
 * it will drop back to it, in pixels. Without this margin a label that was
 * just pushed off its car would return the moment it was free, collide again,
 * and oscillate.
 */
const HOMING_MARGIN = 6;

export function resolveCollisions(
  boxes: readonly LabelBox[],
  gap = 2,
  obstacles: readonly Obstacle[] = [],
  current?: ReadonlyMap<number, number>,
): Map<number, number> {
  const offsets = new Map<number, number>();
  // Fixed furniture the labels must avoid, such as the camera group.
  const placed: Obstacle[] = [...obstacles];

  const rect = (b: LabelBox, dy: number, pad = 0): Obstacle => ({
    top: b.y - b.height / 2 + dy - pad,
    bottom: b.y + b.height / 2 + dy + pad,
    left: b.x - b.width / 2 - pad,
    right: b.x + b.width / 2 + pad,
  });
  const hit = (r: Obstacle): Obstacle | undefined =>
    placed.find((p) => r.right > p.left && r.left < p.right && r.bottom > p.top && r.top < p.bottom);

  for (const b of [...boxes].sort((a, c) => a.priority - c.priority || a.y - c.y)) {
    // Where this label sat last frame, when the caller is tracking that.
    //
    // Solving afresh every frame is what made labels flit: the walk below is
    // greedy and order-dependent, so two cars drawing level swap which of them
    // gives way, and the answer moves a long way for a tiny change in input.
    // Measured at Singapore, one label swung through 132px and changed
    // direction 17 times in ten seconds. Keeping a position that still works
    // is what stops that, so a label moves only when something is actually in
    // its way.
    const held = current?.get(b.n);
    if (held !== undefined) {
      // Home if there is comfortable room for it, so a label that was pushed
      // aside comes back once the car that displaced it has gone.
      if (held !== 0 && !hit(rect(b, 0, HOMING_MARGIN))) {
        placed.push(rect(b, 0));
        offsets.set(b.n, 0);
        continue;
      }
      if (!hit(rect(b, held))) {
        placed.push(rect(b, held));
        offsets.set(b.n, held);
        continue;
      }
    }

    let dy = 0;
    // Walk upwards until this box clears everything already placed, stopping
    // just above each blocker rather than clearing its whole height. The
    // overshoot that caused threw labels much further than they needed to go.
    for (let guard = 0; guard < 24; guard++) {
      const r = rect(b, dy);
      const blocker = hit(r);
      if (!blocker) {
        placed.push(r);
        break;
      }
      const next = blocker.top - gap - (b.y + b.height / 2);
      // Only ever upwards, so the walk cannot circle between two blockers.
      if (next >= dy) break;
      dy = next;
    }
    offsets.set(b.n, dy);
  }
  return offsets;
}


/**
 * Which turn badges can be drawn where they belong.
 *
 * A badge is never moved. It names the corner it sits beside, so shifting it
 * does not tidy the view, it moves the answer — at Singapore a badge was being
 * pushed 61px off its apex and landed nearer the next corner's, and another
 * went clean off the top of the canvas. Nor is a small shift a way out: two
 * badges only separate once one has moved its whole height clear of the other,
 * which is already far enough to look detached.
 *
 * So a badge is either on its corner or not shown. Where several crowd
 * together, the topmost wins and the rest are dropped, which at phone size
 * says more than three overlapping numbers would. `fixed` holds what a badge
 * must give way to and never displaces: car labels and the camera group.
 */
export function visibleBadges(
  boxes: readonly LabelBox[],
  fixed: readonly Obstacle[],
): Set<number> {
  const shown = new Set<number>();
  const placed: Obstacle[] = [...fixed];

  // Topmost first, so the same badges survive every frame. Badges do not move
  // unless the camera does, so this order is stable.
  for (const b of [...boxes].sort((a, c) => a.y - c.y || a.n - c.n)) {
    const r = {
      top: b.y - b.height / 2,
      bottom: b.y + b.height / 2,
      left: b.x - b.width / 2,
      right: b.x + b.width / 2,
    };
    if (placed.some((p) => r.right > p.left && r.left < p.right && r.bottom > p.top && r.top < p.bottom)) {
      continue;
    }
    placed.push(r);
    shown.add(b.n);
  }
  return shown;
}
