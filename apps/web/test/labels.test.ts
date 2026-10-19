// The label rule and the collision resolver, independent of three.js.

import { describe, expect, it } from 'vitest';
import type { TowerRow } from '@lapline/shared';
import {
  type CarLabel,
  labelledDrivers,
  labelSlots,
  type LabelBox,
  type Obstacle,
  type Placement,
  placeLabels,
  visibleBadges,
} from '../src/scene/labels.js';

const row = (n: number, p: number | null, gap: number | string | null): TowerRow => ({
  n,
  p,
  gap,
  int: null,
  lap: 5,
  last: null,
  best: null,
  tyre: null,
  age: null,
  pit: false,
  lapFlag: null,
  stops: 0,
});

// Leader, then a pack, then one a long way back.
const rows: TowerRow[] = [
  row(1, 1, null),
  row(2, 2, 0.4),
  row(3, 3, 0.9),
  row(4, 4, 1.6),
  row(5, 5, 30.0),
  row(6, 20, '+1 LAP'),
];

describe('labelledDrivers', () => {
  it('always labels the leader', () => {
    expect(labelledDrivers(rows, null, false).has(1)).toBe(true);
  });

  it('labels the selected car', () => {
    expect(labelledDrivers(rows, 5, false).has(5)).toBe(true);
  });

  it('labels cars within a second of the selected car', () => {
    // Selected is 4 at +1.6; 3 is at +0.9 (0.7 away) and 5 at +30 is not.
    const out = labelledDrivers(rows, 4, false);
    expect([...out].sort((a, b) => a - b)).toEqual([1, 3, 4]);
  });

  it('counts the window from the selected car, not from the leader', () => {
    const out = labelledDrivers(rows, 2, false);
    // 2 is at +0.4: 1 (leader, 0) and 3 (+0.9) are both inside a second.
    expect([...out].sort((a, b) => a - b)).toEqual([1, 2, 3]);
  });

  it('leaves out a lapped car, whose gap is text rather than a number', () => {
    expect(labelledDrivers(rows, 4, false).has(6)).toBe(false);
  });

  it('labels everything when the setting says so', () => {
    expect(labelledDrivers(rows, 4, true).size).toBe(rows.length);
  });

  it('labels only the leader when nothing is selected', () => {
    expect([...labelledDrivers(rows, null, false)]).toEqual([1]);
  });

  it('copes with no rows at all', () => {
    expect(labelledDrivers([], 4, false).has(4)).toBe(true);
    expect(labelledDrivers([], null, false).size).toBe(0);
  });
});

// A car at (x, y) with a 5px dot and a 40 by 19 label, as the scene gives them.
const car = (n: number, x: number, y: number, priority = 2): CarLabel => ({ n, x, y, r: 5, width: 40, height: 19, priority });
const rectOf = (l: CarLabel, p: Placement): Obstacle => ({
  left: l.x + p.dx - l.width / 2,
  right: l.x + p.dx + l.width / 2,
  top: l.y + p.dy - l.height / 2,
  bottom: l.y + p.dy + l.height / 2,
});
const clash = (a: Obstacle, b: Obstacle): boolean =>
  a.right > b.left + 0.001 && a.left < b.right - 0.001 && a.bottom > b.top + 0.001 && a.top < b.bottom - 0.001;
const canvas = { top: 0, left: 0, bottom: 290, right: 390 };
const chipSize = (count: number) => ({ width: 40 + String(count).length * 8, height: 32 });

describe('labelSlots', () => {
  it('puts the first slot directly above the dot, just clear of it', () => {
    const [above] = labelSlots({ r: 5, width: 40, height: 19 }, 3);
    expect(above).toEqual({ dx: 0, dy: -(5 + 3 + 9.5) });
  });

  it('keeps every slot within two label heights of the car', () => {
    for (const s of labelSlots({ r: 5, width: 40, height: 19 })) {
      expect(Math.abs(s.dy)).toBeLessThanOrEqual(5 + 3 + 9.5 + 19 + 3);
      expect(Math.abs(s.dx)).toBeLessThanOrEqual(5 + 3 + 20);
    }
  });

  it('clears a bigger dot, as a car close under the chase camera has', () => {
    expect(labelSlots({ r: 40, width: 40, height: 19 })[0]!.dy).toBeLessThan(-40 - 9.5);
  });
});

describe('placeLabels', () => {
  it('puts a lone label above its car', () => {
    const { placed } = placeLabels([car(1, 100, 100)]);
    expect(placed.get(1)?.slot).toBe(0);
  });

  it('never lets two placed labels overlap', () => {
    const pack = Array.from({ length: 12 }, (_, i) => car(i + 1, 100 + i * 6, 100 + i * 3));
    const { placed } = placeLabels(pack, { bounds: canvas });
    const rects = pack.filter((l) => placed.has(l.n)).map((l) => rectOf(l, placed.get(l.n)!));
    for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) expect(clash(rects[i]!, rects[j]!)).toBe(false);
  });

  it('keeps every label beside its own car, never far away', () => {
    const pack = Array.from({ length: 20 }, (_, i) => car(i + 1, 80 + i * 4, 120 + i * 2));
    const { placed } = placeLabels(pack, { bounds: canvas, chipSize });
    for (const [, p] of placed) expect(Math.hypot(p.dx, p.dy)).toBeLessThan(50);
  });

  it('labels the selected car and the leader before anyone else', () => {
    const pack = [car(1, 100, 100, 2), car(2, 101, 100, 2), car(3, 102, 100, 1), car(4, 103, 100, 0)];
    const { placed } = placeLabels(pack, { bounds: canvas, chipSize });
    expect(placed.get(4)?.slot).toBe(0);
    expect(placed.has(3)).toBe(true);
  });

  it('tries beside and below when above is taken', () => {
    const blocked = { left: 60, right: 140, top: 60, bottom: 92 };
    const { placed } = placeLabels([car(1, 100, 100)], { obstacles: [blocked] });
    expect(placed.get(1)?.slot).toBe(1);
  });

  it('keeps labels off the furniture', () => {
    const camera = { top: 8, bottom: 52, left: 240, right: 378 };
    const l = car(1, 300, 60);
    const { placed } = placeLabels([l], { obstacles: [camera], bounds: canvas });
    expect(clash(rectOf(l, placed.get(1)!), camera)).toBe(false);
  });

  it('keeps labels on the canvas rather than pushing them off the top', () => {
    const l = car(1, 100, 6);
    const { placed } = placeLabels([l], { bounds: canvas });
    expect(rectOf(l, placed.get(1)!).top).toBeGreaterThanOrEqual(0);
  });

  it('terminates and accounts for every car when far too many crowd one spot', () => {
    // Every car is in one place, so every car left over is in the one chip.
    const many = Array.from({ length: 40 }, (_, i) => car(i + 1, 100, 100));
    const { placed, bunches } = placeLabels(many, { bounds: canvas, chipSize });
    expect(placed.size + bunches.reduce((s, b) => s + b.cars.length, 0)).toBe(40);
  });
});

describe('placeLabels, keeping positions between frames', () => {
  it('keeps a held slot that still works, even when a better one is free', () => {
    // Slot 2 is to the right. Above is free, but not by the homing margin.
    const near = { left: 60, right: 140, top: 60, bottom: 71 };
    const { placed } = placeLabels([car(1, 100, 100)], { obstacles: [near], held: new Map([[1, 2]]) });
    expect(placed.get(1)?.slot).toBe(2);
  });

  it('goes back above once there is comfortable room', () => {
    const { placed } = placeLabels([car(1, 100, 100)], { held: new Map([[1, 2]]) });
    expect(placed.get(1)?.slot).toBe(0);
  });

  it('moves a held label whose slot has stopped working', () => {
    const blocker = { left: 110, right: 160, top: 85, bottom: 115 };
    const { placed } = placeLabels([car(1, 100, 100)], { obstacles: [blocker], held: new Map([[1, 2]]) });
    expect(placed.get(1)?.slot).not.toBe(2);
  });

  it('needs the margin to come back out of a chip, so it does not blink', () => {
    // Above is free by 2px only: enough to fit, not enough to return. The
    // slot above spans 73 to 92; the rest are boxed in.
    const tight = { left: 60, right: 140, top: 40, bottom: 71 };
    const box = [tight, { left: 60, right: 140, top: 104, bottom: 140 }, { left: 0, right: 74, top: 79, bottom: 140 }, { left: 126, right: 200, top: 79, bottom: 140 }];
    const fresh = placeLabels([car(1, 100, 100)], { obstacles: box });
    const returning = placeLabels([car(1, 100, 100)], { obstacles: box, held: new Map([[1, -1]]) });
    expect(fresh.placed.has(1)).toBe(true);
    expect(returning.placed.has(1)).toBe(false);
  });
});

describe('placeLabels, bunches', () => {
  const pack = Array.from({ length: 16 }, (_, i) => car(i + 1, 150 + (i % 4) * 3, 150 + Math.floor(i / 4) * 3));

  it('gathers the cars it could not label into one chip', () => {
    const { placed, bunches } = placeLabels(pack, { bounds: canvas, chipSize });
    expect(bunches).toHaveLength(1);
    expect(placed.size + bunches[0]!.cars.length).toBe(16);
    for (const n of bunches[0]!.cars) expect(placed.has(n)).toBe(false);
  });

  it('keeps the chip off the labels and on the canvas', () => {
    const { placed, bunches } = placeLabels(pack, { bounds: canvas, chipSize });
    const b = bunches[0]!;
    const chip = { left: b.x - b.width / 2, right: b.x + b.width / 2, top: b.y - b.height / 2, bottom: b.y + b.height / 2 };
    expect(chip.top).toBeGreaterThanOrEqual(0);
    for (const l of pack) if (placed.has(l.n)) expect(clash(chip, rectOf(l, placed.get(l.n)!))).toBe(false);
  });

  it('makes separate chips for packs in different places', () => {
    const two = [
      ...Array.from({ length: 10 }, (_, i) => car(i + 1, 80, 80)),
      ...Array.from({ length: 10 }, (_, i) => car(i + 11, 300, 220)),
    ];
    const { bunches } = placeLabels(two, { bounds: canvas, chipSize });
    expect(bunches).toHaveLength(2);
  });

  it('folds ordinary labels under a chip into it, but never the selected car', () => {
    // So tight a pack that the chip has nowhere clear to go.
    const tight = Array.from({ length: 30 }, (_, i) => car(i + 1, 100 + (i % 3), 100, i === 0 ? 0 : 2));
    const { placed, bunches } = placeLabels(tight, { bounds: canvas, chipSize });
    expect(placed.has(1)).toBe(true);
    expect(placed.size + bunches.reduce((s, b) => s + b.cars.length, 0)).toBe(30);
  });

  it('makes no chip for a single car, which would only crowd out other labels', () => {
    // Boxed in on every side, far from any other car.
    const walls = [{ left: 0, right: 390, top: 0, bottom: 290 }];
    const { placed, bunches } = placeLabels([car(1, 100, 100)], { obstacles: walls, chipSize });
    expect(placed.has(1)).toBe(false);
    expect(bunches).toHaveLength(0);
  });

  it('sets the chip beside the pack rather than over it, when there is room', () => {
    const dots = pack.map((l) => ({ left: l.x - 5, right: l.x + 5, top: l.y - 5, bottom: l.y + 5 }));
    const { bunches } = placeLabels(pack, { bounds: canvas, chipSize, dots });
    const b = bunches[0]!;
    const chip = { left: b.x - b.width / 2, right: b.x + b.width / 2, top: b.y - b.height / 2, bottom: b.y + b.height / 2 };
    for (const d of dots) expect(clash(chip, d)).toBe(false);
  });

  it('draws no chip when nothing is left over, or when no size is given', () => {
    expect(placeLabels([car(1, 100, 100)], { chipSize }).bunches).toHaveLength(0);
    expect(placeLabels(pack, { bounds: canvas }).bunches).toHaveLength(0);
  });
});

describe('visibleBadges', () => {
  const badge = (n: number, y: number, x = 100): LabelBox => ({
    n,
    x,
    y,
    width: 17,
    height: 17,
    priority: 3,
  });

  it('shows every badge when nothing is in the way', () => {
    expect(visibleBadges([badge(1, 50), badge(2, 150)], [])).toEqual(new Set([1, 2]));
  });

  it('drops the lower of two that overlap rather than moving either', () => {
    // This is what put turn 12 in the wrong place: it was being shifted 61px
    // off its apex to dodge its neighbours.
    const shown = visibleBadges([badge(1, 100), badge(2, 110)], []);
    expect(shown).toEqual(new Set([1]));
  });

  it('keeps only one where several crowd a hairpin', () => {
    const shown = visibleBadges([badge(1, 100), badge(2, 104), badge(3, 108)], []);
    expect(shown.size).toBe(1);
  });

  it('gives way to a car label instead of displacing it', () => {
    const label: Obstacle = { top: 92, bottom: 108, left: 80, right: 120 };
    expect(visibleBadges([badge(1, 100)], [label])).toEqual(new Set());
  });

  it('leaves badges elsewhere on the circuit alone', () => {
    const label: Obstacle = { top: 92, bottom: 108, left: 80, right: 120 };
    expect(visibleBadges([badge(1, 100), badge(2, 250, 300)], [label])).toEqual(new Set([2]));
  });

  it('picks the same badges whatever order they arrive in, so none flicker', () => {
    const boxes = [badge(3, 100), badge(1, 104), badge(2, 108)];
    const a = visibleBadges(boxes, []);
    const b = visibleBadges([...boxes].reverse(), []);
    expect([...a]).toEqual([...b]);
  });

  it('keeps badges that only touch at the edges', () => {
    // Exactly adjacent, not overlapping: both are legible, so both stay.
    expect(visibleBadges([badge(1, 100), badge(2, 117)], []).size).toBe(2);
  });
});
