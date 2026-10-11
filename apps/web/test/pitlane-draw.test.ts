import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { buildPitLane, dashedRibbonGeometry } from '../src/scene/detail.js';
import { PX } from '../src/scene/geometry.js';

const DASH = 3 * PX;
const GAP = 3 * PX;

/** Each dash is six vertices: two triangles sharing the quad's corners. */
function dashes(g: THREE.BufferGeometry): THREE.Vector3[][] {
  const pos = g.getAttribute('position');
  const out: THREE.Vector3[][] = [];
  for (let i = 0; i < pos.count; i += 6) {
    const quad: THREE.Vector3[] = [];
    for (let k = 0; k < 6; k++) quad.push(new THREE.Vector3(pos.getX(i + k), pos.getY(i + k), pos.getZ(i + k)));
    out.push(quad);
  }
  return out;
}

function straight(length: number, step = 1): THREE.Vector3[] {
  const pts: THREE.Vector3[] = [];
  for (let x = 0; x <= length; x += step) pts.push(new THREE.Vector3(x, 0, 0));
  return pts;
}

describe('dashedRibbonGeometry', () => {
  it('spaces dashes along the path by arc length', () => {
    const g = dashedRibbonGeometry(straight(30), 0.5, DASH, GAP, 0);
    expect(dashes(g).length).toBe(Math.ceil(30 / (DASH + GAP)));
  });

  it('leaves the path open, unlike a closed ribbon', () => {
    // An L, so a quad joining the end back to the start would be long and
    // would cut across the middle.
    const pts = [...straight(20), ...Array.from({ length: 21 }, (_, i) => new THREE.Vector3(20, 0, -i))];
    const g = dashedRibbonGeometry(pts, 0.5, DASH, GAP, 0);
    for (const quad of dashes(g)) {
      const span = Math.max(...quad.map((a) => Math.max(...quad.map((b) => a.distanceTo(b)))));
      // A dash is at most its own length plus its width across the diagonal.
      expect(span).toBeLessThan(DASH * 2);
    }
  });

  it('makes the ribbon the width it was asked for', () => {
    const g = dashedRibbonGeometry(straight(30), 0.5, DASH, GAP, 0);
    const quad = dashes(g)[0]!;
    // The path runs along x, so the width is across z.
    const zs = quad.map((p) => p.z);
    expect(Math.max(...zs) - Math.min(...zs)).toBeCloseTo(1.0, 5);
  });

  it('lifts the ribbon clear of the track', () => {
    const g = dashedRibbonGeometry(straight(30), 0.5, DASH, GAP, 0.04);
    for (const quad of dashes(g)) for (const p of quad) expect(p.y).toBeCloseTo(0.04, 5);
  });

  it('follows elevation along the path', () => {
    const pts = straight(30).map((p) => new THREE.Vector3(p.x, p.x / 10, 0));
    const g = dashedRibbonGeometry(pts, 0.5, DASH, GAP, 0);
    const all = dashes(g).flat();
    expect(Math.max(...all.map((p) => p.y))).toBeGreaterThan(2);
  });

  it('is empty for a path too short to draw', () => {
    expect(dashedRibbonGeometry([], 0.5, DASH, GAP, 0).getAttribute('position')).toBeUndefined();
    expect(
      dashedRibbonGeometry([new THREE.Vector3(0, 0, 0)], 0.5, DASH, GAP, 0).getAttribute('position'),
    ).toBeUndefined();
  });

  it('is empty for a path of no length, rather than NaN', () => {
    const same = [new THREE.Vector3(5, 0, 5), new THREE.Vector3(5, 0, 5), new THREE.Vector3(5, 0, 5)];
    const g = dashedRibbonGeometry(same, 0.5, DASH, GAP, 0);
    const pos = g.getAttribute('position');
    if (pos) for (let i = 0; i < pos.count * 3; i++) expect(Number.isNaN(pos.array[i])).toBe(false);
  });
});

describe('buildPitLane', () => {
  // The lane's label needs a canvas, so what it looks like is checked in a
  // real browser by tools/scene-check.mjs. What is worth asserting here is
  // that a circuit with no derived lane draws nothing at all.
  it('draws nothing when the server could not derive a lane', () => {
    expect(buildPitLane([])).toBeNull();
    expect(buildPitLane([new THREE.Vector3(0, 0, 0)])).toBeNull();
  });
});
