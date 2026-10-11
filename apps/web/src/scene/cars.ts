// Cars, their labels and tap-to-select picking.
//
// Each car keeps the position it is sliding from and to, so motion is smooth
// between 4 Hz frames. The hit sphere is far larger than the car, because a
// thumb on a phone is not precise.
//
// Ported from reference/prototype/public/app.js.

import * as THREE from 'three';
import { storeState } from '../store/store.js';
import { COLORS } from './colours.js';

export interface Telemetry {
  sp: number | null;
  gear: number | null;
  rpm: number | null;
  thr: number | null;
  brk: number | null;
  drs: number | null;
}

export interface Car {
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  hit: THREE.Mesh;
  halo: THREE.Mesh;
  label: THREE.Sprite;
  from: THREE.Vector3 | null;
  to: THREE.Vector3 | null;
  t0: number;
  stale: boolean;
  tel?: Telemetry;
}

export const carGroup = new THREE.Group();
export const cars = new Map<number, Car>();

const carGeo = new THREE.SphereGeometry(0.85, 20, 14);
/** Generous, because a thumb is not a mouse. */
const hitGeo = new THREE.SphereGeometry(3, 8, 6);
const haloGeo = new THREE.TorusGeometry(1.7, 0.18, 8, 32);

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

function labelSprite(text: string, colour: string): THREE.Sprite {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 64;
  const g = c.getContext('2d')!;
  g.font = '700 38px "Barlow Semi Condensed", system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = 'rgba(14,22,38,0.85)';
  roundRect(g, 14, 10, 100, 44, 10);
  g.fill();
  g.fillStyle = colour;
  g.fillRect(14, 50, 100, 4);
  g.fillStyle = '#F2EBDD';
  g.fillText(text, 64, 32);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  s.scale.set(5, 2.5, 1);
  s.renderOrder = 10;
  return s;
}

export function ensureCar(n: number): Car {
  const existing = cars.get(n);
  if (existing) return existing;
  const d = storeState().drivers.get(n) || { code: String(n), colour: '#8C9AB5' };
  const mesh = new THREE.Mesh(carGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(d.colour), transparent: true }));
  const hit = new THREE.Mesh(hitGeo, new THREE.MeshBasicMaterial({ visible: false }));
  hit.userData.n = n;
  mesh.add(hit);
  const halo = new THREE.Mesh(haloGeo, new THREE.MeshBasicMaterial({ color: COLORS.flood }));
  halo.rotation.x = Math.PI / 2;
  halo.visible = false;
  mesh.add(halo);
  const label = labelSprite(d.code, d.colour);
  label.position.set(0, 3, 0);
  mesh.add(label);
  carGroup.add(mesh);
  const car: Car = { mesh, hit, halo, label, from: null, to: null, t0: 0, stale: false };
  cars.set(n, car);
  return car;
}

export function clearCars(): void {
  for (const c of cars.values()) carGroup.remove(c.mesh);
  cars.clear();
}

/** The car under a tap, in normalised device coordinates, or null. */
export function pickCarAt(ndc: THREE.Vector2, camera: THREE.Camera): number | null {
  const ray = new THREE.Raycaster();
  ray.setFromCamera(ndc, camera);
  const hits = ray.intersectObjects(
    [...cars.values()].map((c) => c.hit),
    false,
  );
  return hits.length ? (hits[0]!.object.userData.n as number) : null;
}
