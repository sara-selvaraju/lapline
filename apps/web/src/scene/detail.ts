// The circuit's detail layers, drawn onto the outline.
//
// Everything here is addressed by index into the outline, which is how the
// protocol carries it: the index gives the position and the local direction,
// and both stay right when the elevation setting changes.

import * as THREE from 'three';
import type { SectorBoundary, TrackMarker } from '@lapline/shared';
import { COLORS } from './colours.js';
import { PX } from './geometry.js';

/** docs/DESIGN.md: 17px badge, 14px out from the apex. */
const BADGE_PX = 17;
const BADGE_OFFSET_PX = 14;
/** Sector ticks 2.2px flood; marshal ticks 1px haze at 45%. */
const SECTOR_TICK_PX = 2.2;
const MARSHAL_TICK_PX = 1;
const MARSHAL_TICK_OPACITY = 0.45;
/** How far a tick reaches either side of the racing line. */
const TICK_HALF_WIDTH = 1.1;

/** Outward is away from the circuit's middle, so badges sit off the track. */
export function outwardNormal(points: readonly THREE.Vector3[], index: number, centre: THREE.Vector3): THREE.Vector3 {
  const n = points.length;
  const a = points[(index - 1 + n) % n]!;
  const b = points[(index + 1) % n]!;
  const tangent = new THREE.Vector3().subVectors(b, a).setY(0).normalize();
  const normal = new THREE.Vector3(-tangent.z, 0, tangent.x);
  const away = new THREE.Vector3().subVectors(points[index]!, centre).setY(0);
  // Of the two perpendiculars, take the one pointing away from the middle.
  if (normal.dot(away) < 0) normal.negate();
  return normal;
}

export function centreOf(points: readonly THREE.Vector3[]): THREE.Vector3 {
  const c = new THREE.Vector3();
  for (const p of points) c.add(p);
  return points.length ? c.divideScalar(points.length) : c;
}

/** A turn badge: a filled circle with a thin border and the number inside. */
function badgeTexture(label: string): THREE.CanvasTexture {
  const scale = 8;
  const size = BADGE_PX * scale;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const g = c.getContext('2d')!;
  const r = size / 2;

  g.beginPath();
  g.arc(r, r, r - scale / 2, 0, Math.PI * 2);
  g.fillStyle = '#15213A';
  g.fill();
  g.lineWidth = scale;
  g.strokeStyle = '#3A4D74';
  g.stroke();

  g.font = `700 ${10 * scale}px "Barlow Semi Condensed", system-ui, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = '#C9D1DE';
  g.fillText(label, r, r);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** A small flood-coloured label, for S1, S2, S3 and "Pit lane". */
function textTexture(label: string, px: number, colour: string, weight = 600): THREE.CanvasTexture {
  const scale = 8;
  const probe = document.createElement('canvas').getContext('2d')!;
  probe.font = `${weight} ${px * scale}px "Barlow Semi Condensed", system-ui, sans-serif`;
  const w = Math.ceil(probe.measureText(label).width);
  const h = Math.ceil(px * scale * 1.3);
  const c = document.createElement('canvas');
  c.width = Math.max(w, 1);
  c.height = h;
  const g = c.getContext('2d')!;
  g.font = `${weight} ${px * scale}px "Barlow Semi Condensed", system-ui, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = colour;
  g.fillText(label, c.width / 2, h / 2);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.userData.aspect = c.width / h;
  tex.userData.heightPx = h / scale;
  return tex;
}

export interface BadgeSprite {
  sprite: THREE.Sprite;
  /** Where it sits before collision avoidance nudges it. */
  base: THREE.Vector3;
}

/** Turn badges, each pushed out from its apex and clear of the track. */
export function buildTurnBadges(points: readonly THREE.Vector3[], turns: readonly TrackMarker[]): BadgeSprite[] {
  const centre = centreOf(points);
  const out: BadgeSprite[] = [];
  for (const t of turns) {
    const at = points[t.index];
    if (!at) continue;
    const normal = outwardNormal(points, t.index, centre);
    const base = at.clone().addScaledVector(normal, BADGE_OFFSET_PX * PX);
    const tex = badgeTexture(String(t.number));
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
    sprite.scale.set(BADGE_PX * PX, BADGE_PX * PX, 1);
    sprite.position.copy(base);
    sprite.renderOrder = 8;
    out.push({ sprite, base });
  }
  return out;
}

/** A tick drawn across the track at one outline index. */
function tickGeometry(points: readonly THREE.Vector3[], index: number, centre: THREE.Vector3): THREE.BufferGeometry {
  const at = points[index]!;
  const normal = outwardNormal(points, index, centre);
  return new THREE.BufferGeometry().setFromPoints([
    at.clone().addScaledVector(normal, TICK_HALF_WIDTH),
    at.clone().addScaledVector(normal, -TICK_HALF_WIDTH),
  ]);
}

export interface TickLayer {
  lines: THREE.LineSegments;
  labels: THREE.Sprite[];
}

/** Sector boundaries: a tick across the track and its S1/S2/S3 label. */
export function buildSectorTicks(points: readonly THREE.Vector3[], sectors: readonly SectorBoundary[]): TickLayer {
  const centre = centreOf(points);
  const verts: THREE.Vector3[] = [];
  const labels: THREE.Sprite[] = [];
  for (const s of sectors) {
    const at = points[s.index];
    if (!at) continue;
    const g = tickGeometry(points, s.index, centre);
    const pos = g.getAttribute('position');
    verts.push(
      new THREE.Vector3(pos.getX(0), pos.getY(0), pos.getZ(0)),
      new THREE.Vector3(pos.getX(1), pos.getY(1), pos.getZ(1)),
    );
    g.dispose();

    const tex = textTexture(s.label, 12, '#C9D1DE');
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
    const hPx = tex.userData.heightPx as number;
    sprite.scale.set(hPx * PX * (tex.userData.aspect as number), hPx * PX, 1);
    const normal = outwardNormal(points, s.index, centre);
    sprite.position.copy(at.clone().addScaledVector(normal, 2.4));
    sprite.renderOrder = 8;
    labels.push(sprite);
  }
  const lines = new THREE.LineSegments(
    new THREE.BufferGeometry().setFromPoints(verts),
    new THREE.LineBasicMaterial({ color: COLORS.flood, linewidth: SECTOR_TICK_PX }),
  );
  return { lines, labels };
}

/** Marshal sectors: fainter ticks, no labels. */
export function buildMarshalTicks(points: readonly THREE.Vector3[], markers: readonly TrackMarker[]): THREE.LineSegments {
  const centre = centreOf(points);
  const verts: THREE.Vector3[] = [];
  for (const m of markers) {
    if (!points[m.index]) continue;
    const g = tickGeometry(points, m.index, centre);
    const pos = g.getAttribute('position');
    verts.push(
      new THREE.Vector3(pos.getX(0), pos.getY(0), pos.getZ(0)),
      new THREE.Vector3(pos.getX(1), pos.getY(1), pos.getZ(1)),
    );
    g.dispose();
  }
  return new THREE.LineSegments(
    new THREE.BufferGeometry().setFromPoints(verts),
    new THREE.LineBasicMaterial({
      color: COLORS.haze,
      transparent: true,
      opacity: MARSHAL_TICK_OPACITY,
      linewidth: MARSHAL_TICK_PX,
    }),
  );
}

export { textTexture };
