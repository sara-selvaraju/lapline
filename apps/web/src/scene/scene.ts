// The scene, its camera and its own render loop.
//
// It reads the store directly each frame rather than taking data through React,
// because positions update at display rate and must not cause re-renders.
// M2 turns this into a class with setCircuit/setFrame/setSelection/setCamera.
//
// Ported from reference/prototype/public/app.js.

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { $ } from '../dom.js';
import { state } from '../state.js';
import { cars, carGroup } from './cars.js';
import { COLORS, FRAME_MS } from './colours.js';
import { trackGroup } from './track.js';

const canvas = $<HTMLCanvasElement>('view');

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setClearColor(COLORS.night);

export const scene = new THREE.Scene();
scene.fog = new THREE.Fog(COLORS.night, 230, 440);

export const camera = new THREE.PerspectiveCamera(45, 1, 0.5, 1000);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.12;
controls.maxPolarAngle = Math.PI * 0.47;
controls.minDistance = 6;
controls.maxDistance = 320;
controls.screenSpacePanning = false;

const grid = new THREE.PolarGridHelper(70, 12, 6, 64, COLORS.line, COLORS.line);
(grid.material as THREE.Material).transparent = true;
(grid.material as THREE.Material).opacity = 0.35;
scene.add(grid);
scene.add(trackGroup);
scene.add(carGroup);

/** Fit the 100-unit-wide track into whichever of the two view angles is narrower. */
export function resetView(): void {
  const vfov = THREE.MathUtils.degToRad(camera.fov);
  const hfov = 2 * Math.atan(Math.tan(vfov / 2) * camera.aspect);
  const dist = (54 / Math.tan(Math.min(vfov, hfov) / 2)) * 1.05;
  const dir = new THREE.Vector3(0, 0.82, 0.57).normalize();
  camera.position.copy(dir.multiplyScalar(dist));
  controls.target.set(0, 0, 0);
  controls.update();
}

let viewFitted = false;
function resize(): void {
  const r = canvas.parentElement!.getBoundingClientRect();
  renderer.setSize(r.width, r.height, false);
  camera.aspect = r.width / Math.max(r.height, 1);
  camera.updateProjectionMatrix();
  if (!viewFitted && r.width > 0) {
    resetView();
    viewFitted = true;
  }
}

/** Normalised device coordinates for a pointer event over the canvas. */
export function ndcFor(e: { clientX: number; clientY: number }): THREE.Vector2 {
  const r = canvas.getBoundingClientRect();
  return new THREE.Vector2(
    ((e.clientX - r.left) / r.width) * 2 - 1,
    -((e.clientY - r.top) / r.height) * 2 + 1,
  );
}

export { canvas };

const vA = new THREE.Vector3();
let lastFrame = performance.now();

function animate(now: number): void {
  requestAnimationFrame(animate);
  const dt = now - lastFrame;
  lastFrame = now;

  // The leaders always carry a label; everyone else only when selected or asked for.
  const leaders = new Set((state.timing?.rows || []).slice(0, 3).map((r) => r.n));
  for (const [n, c] of cars) {
    if (!c.to) continue;
    const f = Math.min(1, (now - c.t0) / FRAME_MS);
    if (c.from) c.mesh.position.lerpVectors(c.from, c.to, f);
    else c.mesh.position.copy(c.to);
    c.mesh.material.opacity = c.stale ? 0.3 : 1;
    const sel = n === state.sel;
    c.halo.visible = sel;
    c.label.visible = sel || state.allLabels || leaders.has(n);
    c.label.material.opacity = c.stale ? 0.4 : 1;
  }

  if (state.follow && state.sel != null && cars.get(state.sel)?.to) {
    vA.copy(cars.get(state.sel)!.mesh.position);
    const delta = vA.sub(controls.target).multiplyScalar(Math.min(1, dt / 200));
    controls.target.add(delta);
    camera.position.add(delta);
  }

  controls.update();
  renderer.render(scene, camera);
}

export function startScene(): void {
  new ResizeObserver(resize).observe(canvas.parentElement!);
  resize();
  requestAnimationFrame(animate);
}
