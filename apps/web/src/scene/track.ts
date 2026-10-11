// The track ribbon, its floodlight spill, the curtain down to the ground and the
// start/finish line. Plain three.js, driven by the store — no React.
//
// Ported from reference/prototype/public/app.js.

import * as THREE from 'three';
import { storeState } from '../store/store.js';
import { COLORS } from './colours.js';

export const trackGroup = new THREE.Group();

/**
 * OpenF1's raw coordinates into world units. x and y are scaled about the
 * circuit's centre; z is lifted off the lowest point and exaggerated, because
 * street circuits are nearly flat and would otherwise read as a plane.
 */
export function toWorld(x: number, y: number, z: number, out = new THREE.Vector3()): THREE.Vector3 {
  const t = storeState().transform;
  if (!t) return out.set(0, 0, 0);
  return out.set(
    (x - t.cx) * t.scale,
    Math.max(0, (z - t.cz) * t.scale * storeState().zx),
    -(y - t.cy) * t.scale,
  );
}

export function buildTrack(): void {
  trackGroup.clear();
  const pts = storeState().circuit?.points || [];
  if (pts.length < 10) return;

  const P = pts.map((p) => toWorld(p[0], p[1], p[2]));
  const n = P.length;
  const halfW = 0.55;
  const ribbon = new Float32Array(n * 2 * 3);
  const curtain = new Float32Array(n * 2 * 3);
  const tmp = new THREE.Vector3();

  for (let i = 0; i < n; i++) {
    const a = P[(i - 1 + n) % n]!;
    const b = P[(i + 1) % n]!;
    tmp.subVectors(b, a).setY(0).normalize();
    const nx = -tmp.z;
    const nz = tmp.x;
    const p = P[i]!;
    ribbon.set(
      [p.x + nx * halfW, p.y + 0.02, p.z + nz * halfW, p.x - nx * halfW, p.y + 0.02, p.z - nz * halfW],
      i * 6,
    );
    curtain.set([p.x, p.y, p.z, p.x, 0, p.z], i * 6);
  }

  const idx: number[] = [];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    idx.push(i * 2, j * 2, i * 2 + 1, i * 2 + 1, j * 2, j * 2 + 1);
  }

  const rg = new THREE.BufferGeometry();
  rg.setAttribute('position', new THREE.BufferAttribute(ribbon, 3));
  rg.setIndex(idx);
  trackGroup.add(new THREE.Mesh(rg, new THREE.MeshBasicMaterial({ color: COLORS.flood, side: THREE.DoubleSide })));

  // Soft glow: a wider, faint ribbon underneath, like floodlight spill.
  const glow = new THREE.Mesh(
    rg.clone(),
    new THREE.MeshBasicMaterial({
      color: COLORS.flood,
      transparent: true,
      opacity: 0.12,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  );
  const gpos = glow.geometry.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < n; i++) {
    const p = P[i]!;
    for (const k of [0, 1]) {
      const vi = i * 2 + k;
      const vx = gpos.getX(vi);
      const vz = gpos.getZ(vi);
      gpos.setXYZ(vi, p.x + (vx - p.x) * 3.2, p.y + 0.01, p.z + (vz - p.z) * 3.2);
    }
  }
  trackGroup.add(glow);

  // Curtain from the track down to the ground, so elevation reads when rotated.
  const cg = new THREE.BufferGeometry();
  cg.setAttribute('position', new THREE.BufferAttribute(curtain, 3));
  cg.setIndex(idx);
  trackGroup.add(
    new THREE.Mesh(
      cg,
      new THREE.MeshBasicMaterial({
        color: COLORS.flood,
        transparent: true,
        opacity: 0.07,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    ),
  );

  // Start/finish: the reference lap begins at the line.
  const s0 = P[0]!;
  const s1 = P[2]!;
  tmp.subVectors(s1, s0).setY(0).normalize();
  const sf = new THREE.Mesh(
    new THREE.BoxGeometry(2.6, 0.1, 0.35),
    new THREE.MeshBasicMaterial({ color: COLORS.night }),
  );
  sf.position.copy(s0).setY(s0.y + 0.06);
  sf.rotation.y = Math.atan2(tmp.x, tmp.z);
  trackGroup.add(sf);
}
