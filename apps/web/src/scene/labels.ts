// Which cars carry a label, and keeping those labels off each other.
//
// docs/DESIGN.md: the leader, the selected car, and cars within 1.0 s of the
// selected car. The "label every car" setting overrides it. Labels avoid each
// other in screen space, and cars bunched too tightly to label share a
// "+n cars" chip.

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

/** A box on screen, centre and size in CSS pixels. Badges are laid out as these. */
export interface LabelBox {
  n: number;
  /** Screen position of the box's centre, in CSS pixels. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Lower sorts first and keeps its place; others move around it. */
  priority: number;
}

export interface Obstacle {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

/** The part of the screen labels and chips must stay inside, in pixels. */
export interface Bounds {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

/** A car wanting a label: where its dot is on screen, and the label's size. */
export interface CarLabel {
  n: number;
  /** The dot's centre on screen, in CSS pixels. */
  x: number;
  y: number;
  /** The dot's radius on screen. Dots are world-sized, so this varies. */
  r: number;
  width: number;
  height: number;
  /** Lower is placed first: 0 the selected car, 1 the leader, 2 the rest. */
  priority: number;
}

/** Where a label went: which slot, and its centre's offset from the dot. */
export interface Placement {
  slot: number;
  dx: number;
  dy: number;
}

/** Two or more cars whose labels did not fit, drawn as one "+n cars" chip. */
export interface Bunch {
  cars: number[];
  /** The chip's centre, in CSS pixels. */
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Clear space between a dot and its label, and between neighbouring boxes. */
export const LABEL_GAP = 3;

/**
 * How much clear space a label needs before it returns to a better slot, or
 * comes back at all after being folded into a chip. Without this margin a
 * label would flip back the moment it had exactly enough room, be crowded
 * out again by the next frame's movement, and blink.
 */
const HOMING_MARGIN = 6;

/** Cars without a label this close together share one chip. */
const BUNCH_LINK_PX = 56;

/**
 * Where a label may sit, best first, as offsets of its centre from the dot.
 *
 * Every slot touches the dot it names, or nearly: above it, below it, to
 * either side, then the corners, then a second row above and below. The old
 * resolver only ever walked upwards and had no limit, which in a pack sent
 * labels 230px from their cars, in a column down the middle of the circuit
 * where they named nothing. A label that has no slot here is not drawn at
 * all; its car is counted in a chip instead, which DESIGN.md asks for.
 */
export function labelSlots(l: Pick<CarLabel, 'r' | 'width' | 'height'>, gap = LABEL_GAP): Array<{ dx: number; dy: number }> {
  const v = l.r + gap + l.height / 2;
  const h = l.r + gap + l.width / 2;
  const row = l.height + gap;
  return [
    { dx: 0, dy: -v },
    { dx: 0, dy: v },
    { dx: h, dy: 0 },
    { dx: -h, dy: 0 },
    { dx: l.width / 2, dy: -v },
    { dx: -l.width / 2, dy: -v },
    { dx: l.width / 2, dy: v },
    { dx: -l.width / 2, dy: v },
    { dx: 0, dy: -v - row },
    { dx: 0, dy: v + row },
  ];
}

const overlaps = (a: Obstacle, b: Obstacle): boolean =>
  a.right > b.left && a.left < b.right && a.bottom > b.top && a.top < b.bottom;

const inside = (r: Obstacle, b: Bounds): boolean =>
  r.top >= b.top && r.bottom <= b.bottom && r.left >= b.left && r.right <= b.right;

function box(x: number, y: number, width: number, height: number, pad = 0): Obstacle {
  return {
    left: x - width / 2 - pad,
    right: x + width / 2 + pad,
    top: y - height / 2 - pad,
    bottom: y + height / 2 + pad,
  };
}

/**
 * Places car labels beside their cars, and gathers the ones that do not fit
 * into "+n cars" chips.
 *
 * Greedy, in priority order, so the selected car and the leader are always
 * labelled. `held` is what each label did last frame — the slot it used, or
 * -1 if it was folded into a chip — and a label keeps that while it still
 * works. Solving afresh every frame is what made labels flit at Singapore:
 * the greedy answer moves a long way for a tiny change in input.
 *
 * `chipSize` gives a chip's size for a count, since the text sets its width.
 */
export function placeLabels(
  labels: readonly CarLabel[],
  opts: {
    obstacles?: readonly Obstacle[];
    held?: ReadonlyMap<number, number>;
    bounds?: Bounds;
    chipSize?: (count: number) => { width: number; height: number };
    /** Every car's dot on screen. A chip avoids covering the cars it stands for. */
    dots?: readonly Obstacle[];
    gap?: number;
  } = {},
): { placed: Map<number, Placement>; bunches: Bunch[] } {
  const gap = opts.gap ?? LABEL_GAP;
  const placedRects: Array<{ n: number; rect: Obstacle; priority: number }> = [];
  const fixed: Obstacle[] = [...(opts.obstacles ?? [])];
  const placed = new Map<number, Placement>();
  const left: CarLabel[] = [];

  const free = (r: Obstacle, pad: number): boolean => {
    const padded = { left: r.left - pad, right: r.right + pad, top: r.top - pad, bottom: r.bottom + pad };
    if (opts.bounds && !inside(r, opts.bounds)) return false;
    return !fixed.some((o) => overlaps(padded, o)) && !placedRects.some((p) => overlaps(padded, p.rect));
  };

  for (const l of [...labels].sort((a, c) => a.priority - c.priority || a.y - c.y || a.n - c.n)) {
    const slots = labelSlots(l, gap);
    const rectAt = (i: number): Obstacle => box(l.x + slots[i]!.dx, l.y + slots[i]!.dy, l.width, l.height);
    const held = opts.held?.get(l.n);

    let chosen = -1;
    if (held !== undefined && held >= 0 && held < slots.length) {
      // Back to the best slot once there is comfortable room for it, so a
      // label pushed aside returns when the car that displaced it has gone.
      if (held !== 0 && free(rectAt(0), HOMING_MARGIN)) chosen = 0;
      else if (free(rectAt(held), 0)) chosen = held;
    }
    if (chosen < 0) {
      // A label folded into a chip last frame needs the margin to come back.
      const pad = held === -1 ? HOMING_MARGIN : 0;
      chosen = slots.findIndex((_, i) => free(rectAt(i), pad));
    }

    if (chosen < 0) {
      left.push(l);
      continue;
    }
    placedRects.push({ n: l.n, rect: rectAt(chosen), priority: l.priority });
    placed.set(l.n, { slot: chosen, dx: slots[chosen]!.dx, dy: slots[chosen]!.dy });
  }

  const bunches: Bunch[] = [];
  if (!opts.chipSize) return { placed, bunches };

  // Cars left without a label, grouped by how close they are on screen.
  const groups: CarLabel[][] = [];
  for (const l of left) {
    const near = groups.filter((g) => g.some((o) => Math.hypot(o.x - l.x, o.y - l.y) <= BUNCH_LINK_PX));
    const merged = [l, ...near.flat()];
    for (const g of near) groups.splice(groups.indexOf(g), 1);
    groups.push(merged);
  }

  for (const g of groups.sort((a, c) => c.length - a.length)) {
    // One car is not a bunch. Its label had nowhere to go, so a wider chip
    // has nowhere either and would only push other labels out to make room;
    // the car goes unlabelled and can still be tapped.
    if (g.length < 2) continue;
    const cars = g.map((l) => l.n);
    const size = opts.chipSize(cars.length);
    const cx = g.reduce((s, l) => s + l.x, 0) / g.length;
    const cy = g.reduce((s, l) => s + l.y, 0) / g.length;
    const r = Math.max(...g.map((l) => l.r));
    const slots = labelSlots({ r, width: size.width, height: size.height }, gap);
    const rects = slots.map((s) => box(cx + s.dx, cy + s.dy, size.width, size.height));

    // Beside the pack rather than on it, if there is room: a chip covering
    // the cars it counts hides the very thing it is pointing at.
    const dots = opts.dots ?? [];
    let at = rects.findIndex((rect) => free(rect, 0) && !dots.some((d) => overlaps(rect, d)));
    if (at < 0) at = rects.findIndex((rect) => free(rect, 0));
    if (at < 0) {
      // Nowhere clear: take the first slot that only covers ordinary labels
      // and fold those cars into the chip too. A chip standing for its whole
      // pack says more than a heap of labels it would otherwise sit on.
      at = rects.findIndex(
        (rect) =>
          (!opts.bounds || inside(rect, opts.bounds)) &&
          !fixed.some((o) => overlaps(rect, o)) &&
          !placedRects.some((p) => p.priority < 2 && overlaps(rect, p.rect)),
      );
      if (at < 0) at = 0;
      for (let i = placedRects.length - 1; i >= 0; i--) {
        const p = placedRects[i]!;
        if (p.priority >= 2 && overlaps(rects[at]!, p.rect)) {
          placedRects.splice(i, 1);
          placed.delete(p.n);
          cars.push(p.n);
        }
      }
    }
    // The count may have grown, and with it the chip.
    const final = opts.chipSize(cars.length);
    const s = slots[at]!;
    const bunch = { cars, x: cx + s.dx, y: cy + s.dy, width: final.width, height: final.height };
    fixed.push(box(bunch.x, bunch.y, bunch.width, bunch.height));
    bunches.push(bunch);
  }
  return { placed, bunches };
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
