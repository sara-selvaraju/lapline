// Car visuals, to docs/DESIGN.md.
//
// A 10px dot in the team colour with a 1.5px night outline, a 16px flood ring
// when selected, and stale cars at 45% opacity and greyed. Sizes are given in
// pixels by the design and converted once here: the dots are world-sized, so
// the far side of the circuit reads as further away, which is the point of
// showing it in 3D at all.

import * as THREE from 'three';
import { COLORS } from './colours.js';
import { PX } from './geometry.js';
import { fitToTexture } from './sprites.js';

/** docs/DESIGN.md: 10px dot, 1.5px night outline, 16px ring when selected. */
export const DOT_RADIUS = (10 * PX) / 2;
const OUTLINE_RADIUS = DOT_RADIUS + 1.5 * PX;
const RING_RADIUS = (16 * PX) / 2;
/** Far larger than the dot: a thumb on a phone is not a mouse. */
const HIT_RADIUS = 3;

/** Stale is below 45% opacity and greyed, not just faded. */
export const STALE_OPACITY = 0.45;

const dotGeo = new THREE.SphereGeometry(DOT_RADIUS, 20, 14);
const outlineGeo = new THREE.SphereGeometry(OUTLINE_RADIUS, 16, 12);
// 1.5px of tube, so the ring reads at the default zoom rather than vanishing.
const ringGeo = new THREE.TorusGeometry(RING_RADIUS, (1.5 * PX) / 2, 8, 32);
const hitGeo = new THREE.SphereGeometry(HIT_RADIUS, 8, 6);

/**
 * The four above are shared by every car, so disposing one would empty the
 * field. `Scene.clearGroup` checks this before disposing anything it removes;
 * cars do not live in any group it clears, but the cost of saying so is four
 * lines and the cost of forgetting is every car vanishing at once.
 */
export const SHARED_GEOMETRY: ReadonlySet<THREE.BufferGeometry> = new Set([
  dotGeo,
  outlineGeo,
  ringGeo,
  hitGeo,
]);

export interface Car {
  n: number;
  code: string;
  group: THREE.Group;
  dot: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  ring: THREE.Mesh;
  hit: THREE.Mesh;
  label: THREE.Sprite;
  /** Team colour, kept so stale greying can be undone. */
  colour: THREE.Color;
  colourHex: string;
  /** Whether the label is currently drawn in the selected, inverted style. */
  labelSelected: boolean;
  from: THREE.Vector3 | null;
  to: THREE.Vector3 | null;
  t0: number;
  stale: boolean;
  /**
   * Where the label is drawn, in screen pixels off its natural place, eased
   * towards the target below. Held per car because the resolver's answer can
   * still change abruptly and the label must not.
   */
  labelDy: number;
  /**
   * The offset the resolver last settled on. Fed back to it each frame so a
   * label that is not in anyone's way keeps the place it already has.
   */
  labelDyTarget: number;
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

/**
 * A car label. Selected labels invert — flood ground, night text, 15px with a
 * 3px team underline — and the rest are 13px on label-bg with a 2px underline.
 */
export function labelTexture(text: string, colour: string, selected: boolean): THREE.CanvasTexture {
  const scale = 4;
  const fontPx = selected ? 15 : 13;
  const underline = selected ? 3 : 2;
  const padX = 5;
  const padY = 2;

  const probe = document.createElement('canvas').getContext('2d')!;
  probe.font = `700 ${fontPx * scale}px "Barlow Semi Condensed", system-ui, sans-serif`;
  const textW = probe.measureText(text).width;

  const w = Math.ceil(textW + padX * 2 * scale);
  const h = Math.ceil((fontPx + padY * 2 + underline) * scale);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;

  g.fillStyle = selected ? '#F2EBDD' : 'rgba(14,22,38,0.88)';
  roundRect(g, 0, 0, w, h - underline * scale, 4 * scale);
  g.fill();

  g.fillStyle = colour;
  g.fillRect(0, h - underline * scale, w, underline * scale);

  g.font = `700 ${fontPx * scale}px "Barlow Semi Condensed", system-ui, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = selected ? '#0E1626' : '#F2EBDD';
  g.fillText(text, w / 2, (h - underline * scale) / 2);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.userData.aspect = w / h;
  tex.userData.heightPx = h / scale;
  return tex;
}

export function makeCar(n: number, code: string, colour: string): Car {
  const group = new THREE.Group();
  const team = new THREE.Color(colour);

  // An inverted hull: only the far side of a slightly larger sphere is drawn,
  // so it reads as a rim behind the dot. A front-facing sphere would simply
  // cover the dot and punch dark holes in the ribbon underneath.
  const outline = new THREE.Mesh(
    outlineGeo,
    new THREE.MeshBasicMaterial({ color: COLORS.night, side: THREE.BackSide }),
  );
  const dot = new THREE.Mesh(dotGeo, new THREE.MeshBasicMaterial({ color: team.clone(), transparent: true }));
  const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: COLORS.flood }));
  ring.rotation.x = Math.PI / 2;
  ring.visible = false;

  const hit = new THREE.Mesh(hitGeo, new THREE.MeshBasicMaterial({ visible: false }));
  hit.userData.n = n;

  const tex = labelTexture(code, colour, false);
  const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  fitToTexture(label, tex);
  // On the car itself: the scene lifts it clear of the dot in screen pixels.
  label.renderOrder = 10;

  group.add(outline, dot, ring, hit, label);
  return {
    n,
    code,
    group,
    dot,
    ring,
    hit,
    label,
    colour: team,
    colourHex: colour,
    labelSelected: false,
    from: null,
    to: null,
    t0: 0,
    stale: false,
    labelDy: 0,
    labelDyTarget: 0,
  };
}

/** Swaps a label between the normal and inverted styles, redrawing its texture. */
export function setLabelSelected(car: Car, selected: boolean): void {
  if (car.labelSelected === selected) return;
  car.labelSelected = selected;
  const mat = car.label.material as THREE.SpriteMaterial;
  mat.map?.dispose();
  const tex = labelTexture(car.code, car.colourHex, selected);
  mat.map = tex;
  mat.needsUpdate = true;
  fitToTexture(car.label, tex);
}

const GREY = new THREE.Color(COLORS.haze);

/** Stale cars drop to 45% and lose their team colour, so they read as old. */
export function applyStale(car: Car, stale: boolean): void {
  if (car.stale === stale) return;
  car.stale = stale;
  car.dot.material.opacity = stale ? STALE_OPACITY : 1;
  car.dot.material.color.copy(stale ? GREY : car.colour);
  (car.label.material as THREE.SpriteMaterial).opacity = stale ? STALE_OPACITY : 1;
}
