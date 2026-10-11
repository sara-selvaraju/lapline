// Building the track's geometry from a lap trace.
//
// Everything is derived from one closed polyline. Widths are in world units:
// the circuit is scaled so its longer axis spans 100 of them, and the default
// Tilt view fits about 108 across a 390px screen, so one world unit is roughly
// 3.6px. The design gives widths in pixels, so they are converted here once and
// the conversion is named rather than left as magic numbers.

import * as THREE from 'three';

/** World units per CSS pixel at the default Tilt zoom. */
export const PX = 1 / 3.6;

/** docs/DESIGN.md: ribbon about 3.4px, glow about 11px. */
export const RIBBON_HALF_WIDTH = (3.4 * PX) / 2;
export const GLOW_HALF_WIDTH = (11 * PX) / 2;

/** Elevation posts every 5% of the lap. */
export const POST_COUNT = 20;

/**
 * A flat ribbon of a given half-width following the polyline, lifted slightly
 * so it does not fight the ground line for the same pixels.
 */
export function ribbonGeometry(points: readonly THREE.Vector3[], halfWidth: number, lift: number): THREE.BufferGeometry {
  const n = points.length;
  const pos = new Float32Array(n * 2 * 3);
  const tmp = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    const a = points[(i - 1 + n) % n]!;
    const b = points[(i + 1) % n]!;
    // The normal is the tangent turned ninety degrees in the ground plane.
    tmp.subVectors(b, a).setY(0).normalize();
    const nx = -tmp.z;
    const nz = tmp.x;
    const p = points[i]!;
    pos.set(
      [p.x + nx * halfWidth, p.y + lift, p.z + nz * halfWidth, p.x - nx * halfWidth, p.y + lift, p.z - nz * halfWidth],
      i * 6,
    );
  }
  const idx: number[] = [];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    idx.push(i * 2, j * 2, i * 2 + 1, i * 2 + 1, j * 2, j * 2 + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(idx);
  return g;
}

/** The track's shadow on the ground, which is what makes elevation read. */
export function groundLineGeometry(points: readonly THREE.Vector3[]): THREE.BufferGeometry {
  const flat = points.map((p) => new THREE.Vector3(p.x, 0.005, p.z));
  flat.push(flat[0]!.clone());
  return new THREE.BufferGeometry().setFromPoints(flat);
}

/** Vertical ties from the track down to the ground, every 5% of the lap. */
export function postsGeometry(points: readonly THREE.Vector3[]): THREE.BufferGeometry {
  const verts: THREE.Vector3[] = [];
  const step = Math.max(1, Math.floor(points.length / POST_COUNT));
  for (let i = 0; i < points.length; i += step) {
    const p = points[i]!;
    // No post where the track already sits on the ground.
    if (p.y < 0.05) continue;
    verts.push(new THREE.Vector3(p.x, 0, p.z), new THREE.Vector3(p.x, p.y, p.z));
  }
  return new THREE.BufferGeometry().setFromPoints(verts);
}

/** Where the lap begins, and which way the cars go. */
export function startFinish(points: readonly THREE.Vector3[]): { position: THREE.Vector3; rotation: number } {
  const a = points[0]!;
  const b = points[2 % points.length]!;
  const dir = new THREE.Vector3().subVectors(b, a).setY(0).normalize();
  return { position: a.clone().setY(a.y + 0.06), rotation: Math.atan2(dir.x, dir.z) };
}
