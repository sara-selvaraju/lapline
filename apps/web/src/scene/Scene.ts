// The 3D scene.
//
// Imperative by design: positions update at display rate and must never pass
// through React state. The class owns its renderer, camera and render loop, and
// reads the store directly each frame for the things that change often —
// selection, elevation, the label rule. Structural changes come in through the
// methods below.
//
// A seam for a background layer (3D buildings or terrain, out of scope per
// ARCHITECTURE.md) is left as `backgroundGroup`, added to the scene but empty.

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { Circuit, MarshalSectorFlag, Point3, Tick, Timing, Transform } from '@lapline/shared';
import { storeState } from '../store/store.js';
import { applyStale, DOT_RADIUS, makeCar, setLabelSelected, SHARED_GEOMETRY, type Car } from './cars.js';
import { applyPixelSizes, fitToTexture, liftPx, pixelSize, setLiftPx } from './sprites.js';
import { COLORS, FRAME_MS } from './colours.js';
import {
  buildMarshalTicks,
  buildPitLane,
  buildSafetyCar,
  textTexture,
  buildSectorTicks,
  buildTurnBadges,
  buildYellowOverlays,
  type BadgeSprite,
} from './detail.js';
import {
  labelledDrivers,
  visibleBadges,
  resolveCollisions,
  type LabelBox,
  type Obstacle,
} from './labels.js';
import {
  GLOW_HALF_WIDTH,
  groundLineGeometry,
  postsGeometry,
  RIBBON_HALF_WIDTH,
  ribbonGeometry,
  startFinish,
} from './geometry.js';

export type CameraPreset = 'map' | 'tilt' | 'chase';

/**
 * Badges share the collision pass with car labels, which is keyed by driver
 * number. Driver numbers are small positive integers, so badges take keys
 * counting down from a large negative one — distinct, and recognisable on the
 * way back out.
 */
/** How much the view's shape must change before the circuit is refitted. */
const ASPECT_STEP = 0.15;

const BADGE_KEY = -1000;

/** How quickly a turn badge fades back in once a car label has passed. */
const BADGE_FADE_PER_S = 6;

/**
 * How far a hidden badge must be clear before it returns, in pixels.
 *
 * Small, because the dwell below does most of the steadying. A wide margin
 * here keeps badges away long after the car has gone, and since they no
 * longer move aside, one kept out is one not shown at all.
 */
const BADGE_UNBLOCK_PAD = 2;

/** How quickly a car label slides to the position the resolver chose. */
const LABEL_EASE_PER_S = 10;

/** Clear space between the top of a car's dot and the bottom of its label. */
const LABEL_GAP_PX = 3;

/** How long a badge must stay clear before it starts coming back, in ms. */
const BADGE_RETURN_MS = 400;


/** How the camera sits for each preset, as a direction and a distance factor. */
const PRESETS: Record<CameraPreset, { dir: THREE.Vector3; fit: number }> = {
  // Straight down: the whole circuit, no perspective.
  map: { dir: new THREE.Vector3(0, 1, 0.0001).normalize(), fit: 1.0 },
  // The default. Enough tilt to read elevation without losing the shape.
  tilt: { dir: new THREE.Vector3(0, 0.82, 0.57).normalize(), fit: 1.05 },
  // Low and behind the selected car; distance is handled by the follow code.
  chase: { dir: new THREE.Vector3(0, 0.22, 0.97).normalize(), fit: 0.22 },
};

export class Scene {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(45, 1, 0.5, 1000);
  /** Empty seam for a future background layer. */
  readonly backgroundGroup = new THREE.Group();
  readonly trackGroup = new THREE.Group();
  readonly detailGroup = new THREE.Group();
  readonly flagGroup = new THREE.Group();
  readonly scGroup = new THREE.Group();
  readonly carGroup = new THREE.Group();

  private readonly canvas: HTMLCanvasElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly controls: OrbitControls;
  private readonly resizeObserver: ResizeObserver;
  private frameHandle = 0;
  private lastFrame = performance.now();
  private viewFitted = false;
  private preset: CameraPreset = 'tilt';
  private disposables: Array<{ dispose(): void }> = [];
  private readonly cars = new Map<number, Car>();
  private badges: BadgeSprite[] = [];
  private worldPoints: THREE.Vector3[] = [];
  private circuit: Circuit | null = null;
  /** What the flag layer was last drawn for, so it is only rebuilt on change. */
  private paintedFlags = '';
  private readonly noFlags: MarshalSectorFlag[] = [];
  private transform: Circuit['transform'] | null = null;
  private zx = 4;
  /** A jump over a quarter of the map is a seek, so snap rather than slide. */
  private static readonly SNAP = 25;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(COLORS.night);

    this.scene.fog = new THREE.Fog(COLORS.night, 230, 440);

    const grid = new THREE.PolarGridHelper(70, 12, 6, 64, COLORS.line, COLORS.line);
    const gridMat = grid.material as THREE.Material;
    gridMat.transparent = true;
    gridMat.opacity = 0.35;
    this.scene.add(
      grid,
      this.backgroundGroup,
      this.trackGroup,
      this.detailGroup,
      this.flagGroup,
      this.scGroup,
      this.carGroup,
    );

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.maxPolarAngle = Math.PI * 0.47;
    this.controls.minDistance = 6;
    this.controls.maxDistance = 320;
    this.controls.screenSpacePanning = false;

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas.parentElement ?? canvas);
    this.resize();
    this.frameHandle = requestAnimationFrame(this.animate);
  }

  // ---------- structure ----------

  /** Rebuilds the track. `zx` is the elevation exaggeration, 1 to 12. */
  setCircuit(circuit: Circuit | null, zx: number, layers = { turns: true, sectors: true, pitLane: true }): void {
    // Everything `own()`ed belongs to one circuit build, so a rebuild gives the
    // last one back. Without this the array grew by a dozen entries per call —
    // and `setCircuit` is called on every nudge of the elevation slider, not
    // just on a change of circuit.
    for (const d of this.disposables) d.dispose();
    this.disposables = [];
    this.clearGroup(this.trackGroup);
    this.clearGroup(this.detailGroup);
    this.clearGroup(this.flagGroup);
    this.badges = [];
    this.worldPoints = [];
    this.pitLaneLabel = null;
    this.paintedState = '';
    this.circuit = circuit;
    this.paintedFlags = '';
    this.zx = zx;
    this.transform = circuit?.transform ?? null;
    const raw = circuit?.points ?? [];
    if (raw.length < 10 || !circuit) return;

    const points = raw.map((p) => this.toWorld(p, circuit.transform, zx));

    // Glow first: a wide, faint ribbon under the track, like floodlight spill.
    // Kept to hand, because a safety car tints it yellow.
    this.glow = this.own(
      new THREE.MeshBasicMaterial({
        color: COLORS.flood,
        transparent: true,
        opacity: 0.1,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    this.add(this.trackGroup, new THREE.Mesh(this.own(ribbonGeometry(points, GLOW_HALF_WIDTH, 0.01)), this.glow));

    // The ribbon itself.
    this.add(
      this.trackGroup,
      new THREE.Mesh(
        this.own(ribbonGeometry(points, RIBBON_HALF_WIDTH, 0.02)),
        this.own(new THREE.MeshBasicMaterial({ color: COLORS.flood, side: THREE.DoubleSide })),
      ),
    );

    // Ground line and posts. These replace the prototype's curtain: the design
    // asks for a line under the track and ties down to it, which reads as
    // height without filling the middle of the circuit with a solid sheet.
    this.add(
      this.trackGroup,
      new THREE.LineLoop(
        this.own(groundLineGeometry(points)),
        this.own(new THREE.LineBasicMaterial({ color: COLORS.line })),
      ),
    );
    this.add(
      this.trackGroup,
      new THREE.LineSegments(
        this.own(postsGeometry(points)),
        this.own(new THREE.LineBasicMaterial({ color: COLORS.flood, transparent: true, opacity: 0.14 })),
      ),
    );

    // Start/finish, and a chevron showing which way the lap runs.
    const sf = startFinish(points);
    const bar = new THREE.Mesh(
      this.own(new THREE.BoxGeometry(2.6, 0.1, 0.35)),
      this.own(new THREE.MeshBasicMaterial({ color: COLORS.night })),
    );
    bar.position.copy(sf.position);
    bar.rotation.y = sf.rotation;
    this.add(this.trackGroup, bar);

    const chevron = new THREE.Mesh(
      this.own(new THREE.ConeGeometry(0.5, 1.2, 3)),
      this.own(new THREE.MeshBasicMaterial({ color: COLORS.haze })),
    );
    const after = points[Math.min(6, points.length - 1)]!;
    chevron.position.set(after.x, after.y + 1.2, after.z);
    chevron.rotation.x = Math.PI / 2;
    chevron.rotation.z = -sf.rotation;
    this.add(this.trackGroup, chevron);

    this.worldPoints = points;
    this.addDetail(circuit, points, layers);
    if (!this.viewFitted) this.resetView();
  }

  /**
   * A circuit coordinate in world space: centred, floored, scaled, with the
   * elevation exaggeration applied. OpenF1's y is our z, and negated, because
   * three.js looks down -z.
   */
  private toWorld(p: Point3, t: Transform, zx: number): THREE.Vector3 {
    const [x, y, z] = p;
    return new THREE.Vector3(
      (x - t.cx) * t.scale,
      Math.max(0, (z - t.cz) * t.scale * zx),
      -(y - t.cy) * t.scale,
    );
  }

  /** Turn badges, sector and marshal ticks. Each layer is a viewer preference. */
  private addDetail(
    circuit: Circuit,
    points: readonly THREE.Vector3[],
    layers: { turns: boolean; sectors: boolean; pitLane: boolean },
  ): void {
    if (layers.turns && circuit.turns.length) {
      this.badges = buildTurnBadges(points, circuit.turns);
      for (const b of this.badges) this.detailGroup.add(b.sprite);
    }
    if (layers.sectors) {
      if (circuit.marshalSectors.length) {
        this.detailGroup.add(buildMarshalTicks(points, circuit.marshalSectors));
      }
      if (circuit.sectors.length) {
        const { lines, labels } = buildSectorTicks(points, circuit.sectors);
        this.detailGroup.add(lines);
        for (const l of labels) this.detailGroup.add(l);
      }
    }
    if (layers.pitLane && circuit.pitLane.length) {
      const lane = buildPitLane(
        circuit.pitLane.map((p) => this.toWorld(p, circuit.transform, this.zx)),
        points,
      );
      if (lane) {
        this.detailGroup.add(lane.line, lane.label);
        this.pitLaneLabel = lane.label;
      }
    }
  }

  /** New positions from a tick. The loop slides between this and the last. */
  setFrame(tick: Tick): void {
    const t = this.transform;
    if (!t) return;
    const now = performance.now();
    const drivers = storeState().drivers;
    for (const [n, x, y, z, , , , , , , stale] of tick.cars) {
      let car = this.cars.get(n);
      if (!car) {
        const d = drivers.get(n);
        car = makeCar(n, d?.code ?? String(n), d?.colour ?? '#8C9AB5');
        this.cars.set(n, car);
        this.carGroup.add(car.group);
      }
      const to = new THREE.Vector3(
        (x - t.cx) * t.scale,
        Math.max(0, (z - t.cz) * t.scale * this.zx) + 0.9,
        -(y - t.cy) * t.scale,
      );
      car.from = car.to ? car.group.position.clone() : null;
      if (car.from && car.from.distanceTo(to) > Scene.SNAP) car.from = null;
      car.to = to;
      car.t0 = now;
      applyStale(car, Boolean(stale));
    }
  }

  /** Throws the car meshes away, for a new field or a session change. */
  clearCars(): void {
    for (const car of this.cars.values()) this.carGroup.remove(car.group);
    this.cars.clear();
  }

  setSelection(_n: number | null): void {
    // The render loop reads the selection from the store each frame, so the
    // ring and label follow without a push.
  }

  setCamera(preset: CameraPreset): void {
    this.preset = preset;
    this.resetView();
  }

  getCamera(): CameraPreset {
    return this.preset;
  }

  dispose(): void {
    this.clearCars();
    cancelAnimationFrame(this.frameHandle);
    this.resizeObserver.disconnect();
    this.controls.dispose();
    for (const d of this.disposables) d.dispose();
    this.disposables = [];
    this.renderer.dispose();
  }

  // ---------- view ----------

  /** Fits the 100-unit circuit into whichever view angle is narrower. */
  resetView(): void {
    const { dir } = PRESETS[this.preset];
    this.camera.position.copy(dir.clone().multiplyScalar(this.fitDistance()));
    this.controls.target.set(0, 0, 0);
    this.controls.update();
  }

  /** The camera distance that frames the circuit at the current aspect. */
  private fitDistance(): number {
    const { fit } = PRESETS[this.preset];
    const vfov = THREE.MathUtils.degToRad(this.camera.fov);
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * this.camera.aspect);
    return (54 / Math.tan(Math.min(vfov, hfov) / 2)) * fit;
  }

  private resize(): void {
    const parent = this.canvas.parentElement;
    const r = parent ? parent.getBoundingClientRect() : this.canvas.getBoundingClientRect();
    if (r.width === 0) return;
    this.renderer.setSize(r.width, r.height, false);

    const before = this.camera.aspect;
    this.camera.aspect = r.width / Math.max(r.height, 1);
    this.camera.updateProjectionMatrix();

    if (!this.viewFitted) {
      this.resetView();
      this.viewFitted = true;
      return;
    }

    // A rotation changes the shape of the view, and the distance that framed
    // the circuit in the old one does not frame it in the new. Only the
    // distance is re-derived: the direction is left exactly as it is, so a
    // hand-orbited view keeps its angle and a camera preset keeps its own.
    if (Math.abs(this.camera.aspect - before) > ASPECT_STEP) {
      const to = this.controls.target;
      const away = this.camera.position.clone().sub(to);
      if (away.lengthSq() > 0) {
        this.camera.position.copy(to).add(away.setLength(this.fitDistance()));
        this.controls.update();
      }
    }
  }

  /**
   * Every car under a tap, nearest first. The hit spheres are far larger than
   * the dots, because a thumb is not a mouse — which means a tap into a train
   * of cars legitimately hits several, and the caller opens the picker rather
   * than guessing which one was meant.
   */
  pickCars(ndc: THREE.Vector2): number[] {
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const hits = ray.intersectObjects(
      [...this.cars.values()].map((c) => c.hit),
      false,
    );
    const seen = new Set<number>();
    for (const h of hits) {
      const n = h.object.userData.n as number;
      if (!seen.has(n)) seen.add(n);
    }
    return [...seen];
  }

  /** Normalised device coordinates for a pointer over the canvas. */
  ndcFor(e: { clientX: number; clientY: number }): THREE.Vector2 {
    const r = this.canvas.getBoundingClientRect();
    return new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  }

  // ---------- loop ----------

  private readonly animate = (now: number): void => {
    this.frameHandle = requestAnimationFrame(this.animate);
    const dt = now - this.lastFrame;
    this.lastFrame = now;
    this.onFrame(now, dt);
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  };

  private readonly followTarget = new THREE.Vector3();
  private readonly projected = new THREE.Vector3();
  private readonly labelBoxes: LabelBox[] = [];
  /** The track's glow, tinted yellow while the field is neutralised. */
  private glow: THREE.MeshBasicMaterial | null = null;
  /** What the flag group was last painted for, so it is rebuilt only on change. */
  private paintedState = '';
  /** The pit lane's label, which is relabelled while the lane is open. */
  private pitLaneLabel: THREE.Sprite | null = null;

  /**
   * Paints marshal sectors showing a flag. Rebuilt only when the set changes,
   * because it is geometry rather than a transform and a yellow typically
   * stands for a minute or more.
   */
  private paintFlags(timing: Pick<Timing, 'marshalSectors'> | null): void {
    const key = (timing?.marshalSectors ?? this.noFlags).map((f) => `${f.sector}:${f.flag}`).join(',');
    if (key === this.paintedFlags) return;
    this.paintedFlags = key;
    this.clearGroup(this.flagGroup);
    if (!this.circuit || !timing?.marshalSectors.length || this.worldPoints.length === 0) return;
    for (const o of buildYellowOverlays(this.worldPoints, this.circuit.marshalSectors, timing.marshalSectors)) {
      this.flagGroup.add(o.line, o.chip);
    }
  }

  /**
   * What the race state does to the track itself.
   *
   * docs/DESIGN.md: the glow tints yellow under a safety car, the pit lane
   * reads "Pit lane open", and a red flag dims everything so the incident and
   * the stopped cars are what is left to look at.
   */
  private paintState(timing: Timing | null): void {
    const flag = timing?.flag ?? 'GREEN';
    const leader = timing?.rows.find((r) => r.p === 1)?.n ?? null;
    const neutralised = flag === 'SC' || flag === 'SC ENDING';
    // The leader's position is not known on the very first frame after a
    // flag change, so the marker's presence is part of the key: without it
    // the early return below would cache a state that never got drawn.
    const placed = leader != null && Boolean(this.cars.get(leader)?.to);
    const key = `${flag}:${leader}:${placed}`;
    if (key === this.paintedState) return;
    this.paintedState = key;

    if (this.glow) {
      this.glow.color.set(neutralised ? COLORS.yellow : COLORS.flood);
      this.glow.opacity = neutralised ? 0.12 : 0.1;
    }

    // A red flag dims the lot. RedFlag.dc.html draws the outline at 0.3 and
    // its detail fainter still.
    const red = flag === 'RED';
    this.trackGroup.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | undefined;
      if (m && 'opacity' in m) {
        const base = (m.userData.baseOpacity as number | undefined) ?? (m as THREE.Material & { opacity: number }).opacity;
        m.userData.baseOpacity = base;
        (m as THREE.Material & { opacity: number }).opacity = red ? base * 0.3 : base;
        m.transparent = true;
      }
    });
    this.detailGroup.visible = !red;

    // docs/DESIGN.md: the pit lane reads "Pit lane open" under a safety car.
    if (this.pitLaneLabel) {
      const tex = textTexture(neutralised ? 'Pit lane open' : 'Pit lane', 11, neutralised ? '#f2ebdd' : '#8c9ab5');
      const old = this.pitLaneLabel.material.map;
      this.pitLaneLabel.material.map = tex;
      this.pitLaneLabel.material.needsUpdate = true;
      old?.dispose();
      fitToTexture(this.pitLaneLabel, tex);
    }

    this.clearGroup(this.scGroup);
    if (!neutralised || leader == null) return;
    const car = this.cars.get(leader);
    if (!car?.to) return;
    for (const o of buildSafetyCar(this.worldPoints, car.to)) this.scGroup.add(o);
  }

  private onFrame(now: number, dt: number): void {
    const { sel, follow, allLabels, timing } = storeState();
    this.paintFlags(timing);
    this.paintState(timing);
    const rows = timing?.rows ?? [];
    const labelled = labelledDrivers(rows, sel, allLabels);

    for (const [n, car] of this.cars) {
      if (!car.to) continue;
      const f = Math.min(1, (now - car.t0) / FRAME_MS);
      if (car.from) car.group.position.lerpVectors(car.from, car.to, f);
      else car.group.position.copy(car.to);
      car.ring.visible = n === sel;
      car.label.visible = labelled.has(n);
      if (car.label.visible) setLabelSelected(car, n === sel);
    }

    applyPixelSizes(this.scene, this.camera, this.canvas.clientHeight);
    this.layOutLabels(sel, rows, now, dt);

    // Follow, and the chase camera, both track the selected car.
    const target = sel != null ? this.cars.get(sel) : undefined;
    if ((follow || this.preset === 'chase') && target?.to) {
      this.followTarget.copy(target.group.position);
      const delta = this.followTarget.sub(this.controls.target).multiplyScalar(Math.min(1, dt / 200));
      this.controls.target.add(delta);
      this.camera.position.add(delta);
    }
  }

  /**
   * Keeps visible labels off each other. Projecting to screen space is the only
   * way to judge this: two cars far apart in the world can sit on top of each
   * other on screen, and which pairs collide changes as the camera moves.
   *
   * Badges and car labels are laid out separately, and deliberately. A badge
   * marks a corner, and the field streams past every corner continuously, so
   * nudging badges around moving car labels meant re-deciding their positions
   * every frame: the resolver is greedy and order-dependent, so a car creeping
   * a few pixels could flip the order and throw a badge a quarter of the way
   * across the circuit, then snap it back. Badges therefore avoid only things
   * that hold still — each other and the camera group — and fade out of the
   * way of a car label instead of dodging it.
   */
  private layOutLabels(
    sel: number | null,
    rows: readonly { n: number; p: number | null }[],
    now: number,
    dt: number,
  ): void {
    const r = this.canvas.getBoundingClientRect();
    if (r.width === 0) return;
    const leader = rows.find((row) => row.p === 1)?.n;
    const obstacles = this.obstacles();

    // Car labels first, as M2 placed them: they hold the positions, and the
    // selected car holds its place ahead of the leader, ahead of the rest.
    this.labelBoxes.length = 0;
    this.labelLift.clear();
    for (const [n, car] of this.cars) {
      if (!car.label.visible) continue;
      this.projected.copy(car.group.position).project(this.camera);
      // Behind the camera: nothing sensible to lay out.
      if (this.projected.z > 1) {
        car.label.visible = false;
        continue;
      }
      const size = pixelSize(car.label)!;
      // Sat just clear of the dot. The dot is world-sized, so how far that is
      // depends on depth: a car close under the chase camera has a large dot.
      const dotPx = DOT_RADIUS / this.worldPerPixelAt(car.group.position, r.height);
      const lift = dotPx + LABEL_GAP_PX + size.height / 2;
      this.labelLift.set(n, lift);
      this.labelBoxes.push({
        n,
        x: ((this.projected.x + 1) / 2) * r.width,
        y: ((1 - this.projected.y) / 2) * r.height - lift,
        width: size.width,
        height: size.height,
        priority: n === sel ? 0 : n === leader ? 1 : 2,
      });
    }
    // Ease the labels into place rather than snapping. The resolver is greedy
    // and order-dependent, so two cars drawing level can swap which of them
    // holds its place and which gives way, and the answer jumps. Measured at
    // Singapore, a label moved 41 world units between two frames. Easing keeps
    // the decision while losing the teleport — and since a badge yields to
    // whatever a label covers, a steady label is what stops badges blinking.
    // Hand the resolver what each label settled on last frame, so one that is
    // in nobody's way keeps the place it has instead of being re-decided.
    const held = new Map<number, number>();
    for (const box of this.labelBoxes) {
      const car = this.cars.get(box.n);
      if (car) held.set(box.n, car.labelDyTarget);
    }
    const labelOffsets = resolveCollisions(this.labelBoxes, 2, obstacles, held, { top: 0, bottom: r.height });
    const ease = Math.min(1, (dt / 1000) * LABEL_EASE_PER_S);
    for (const [n, dyPx] of labelOffsets) {
      const car = this.cars.get(n);
      if (!car) continue;
      car.labelDyTarget = dyPx;
      car.labelDy += (dyPx - car.labelDy) * ease;
      // Offsets are screen pixels, and so is the lift, so the label lands
      // exactly where the resolver put it whatever the camera is doing.
      setLiftPx(car.label, (this.labelLift.get(n) ?? 0) - car.labelDy);
    }
    // Where the labels ended up, not where they started: a badge has to clear
    // the label's resolved position, which is the one the viewer sees.
    const labelBoxes = this.labelBoxes.map((b) => this.rectAfter(b, this.cars.get(b.n)?.labelDy ?? 0));

    // Badges next, against each other and the camera group only. Nothing in
    // that set moves unless the camera does, so a badge's position is steady.
    this.labelBoxes.length = 0;
    for (let i = 0; i < this.badges.length; i++) {
      const b = this.badges[i]!;
      this.projected.copy(b.base).project(this.camera);
      if (this.projected.z > 1) {
        b.sprite.visible = false;
        b.fade = 0;
        b.clearSince = 0;
        continue;
      }
      this.labelBoxes.push({
        n: BADGE_KEY - i,
        x: ((this.projected.x + 1) / 2) * r.width,
        y: ((1 - this.projected.y) / 2) * r.height,
        width: pixelSize(b.sprite)!.width,
        height: pixelSize(b.sprite)!.height,
        priority: 3,
      });
    }
    // Badges are never moved, only kept or dropped: one names the corner it
    // sits beside, so shifting it moves the answer. Car labels and the camera
    // group are fixed here — a badge gives way to both, never the reverse.
    //
    // Hysteresis: a hidden badge is measured a little larger, so it has to be
    // clear by a margin before it returns and a car label sliding along its
    // edge cannot toggle it frame by frame.
    const padded = this.labelBoxes.map((box) => {
      const b = this.badges[BADGE_KEY - box.n];
      if (!b || b.fade > 0.02) return box;
      return { ...box, width: box.width + BADGE_UNBLOCK_PAD * 2, height: box.height + BADGE_UNBLOCK_PAD * 2 };
    });
    const shown = visibleBadges(padded, [...labelBoxes, ...obstacles]);

    for (const box of this.labelBoxes) {
      const b = this.badges[BADGE_KEY - box.n];
      if (!b) continue;
      // Always exactly on its corner. The only question is whether it is drawn.
      b.sprite.position.copy(b.base);

      // Out at once, back in gently. Going instantly means a badge never
      // actually sits over a car label, and the abrupt half of the change is
      // the one nobody notices — the car label arriving is the eye's event.
      // Easing the return is what stops a badge flickering as cars stream by.
      if (!shown.has(box.n)) {
        b.clearSince = 0;
        b.fade = 0;
      } else {
        // Clear, but not back yet: it has to stay clear for a moment first.
        // A pack running line astern sweeps labels back and forth across a
        // badge, and without this the badge answers every one of them.
        if (b.clearSince === 0) b.clearSince = now;
        if (now - b.clearSince >= BADGE_RETURN_MS) {
          b.fade += (1 - b.fade) * Math.min(1, (dt / 1000) * BADGE_FADE_PER_S);
        }
      }
      const material = b.sprite.material as THREE.SpriteMaterial;
      material.opacity = b.fade;
      // Fully faded counts as not drawn, so the layout checks agree with the eye.
      b.sprite.visible = b.fade > 0.02;
    }
  }

  /** A laid-out box as a screen rectangle, once its offset is applied. */
  private rectAfter(box: LabelBox, dyPx: number): Obstacle {
    return {
      left: box.x - box.width / 2,
      right: box.x + box.width / 2,
      top: box.y - box.height / 2 + dyPx,
      bottom: box.y + box.height / 2 + dyPx,
    };
  }

  /**
   * Where the badges and car labels actually ended up, in canvas pixels.
   *
   * Read back from the sprites themselves rather than recomputed, so what the
   * acceptance checks in tools/ measure is what the viewer sees. Includes the
   * screen furniture labels keep off, so a check can judge the whole layout.
   */
  layout(): {
    boxes: Array<{ kind: 'badge' | 'label'; key: number; x: number; y: number; width: number; height: number }>;
    obstacles: Obstacle[];
  } {
    const r = this.canvas?.getBoundingClientRect();
    const boxes: Array<{ kind: 'badge' | 'label'; key: number; x: number; y: number; width: number; height: number }> =
      [];
    if (!r) return { boxes, obstacles: [] };
    const at = new THREE.Vector3();
    const push = (kind: 'badge' | 'label', key: number, sprite: THREE.Sprite): void => {
      if (!sprite.visible) return;
      const size = pixelSize(sprite);
      if (!size) return;
      sprite.getWorldPosition(at).project(this.camera);
      if (at.z > 1) return;
      boxes.push({
        kind,
        key,
        x: ((at.x + 1) / 2) * r.width,
        y: ((1 - at.y) / 2) * r.height - liftPx(sprite),
        width: size.width,
        height: size.height,
      });
    };
    for (let i = 0; i < this.badges.length; i++) push('badge', this.badges[i]!.number, this.badges[i]!.sprite);
    for (const [n, car] of this.cars) push('label', n, car.label);
    return { boxes, obstacles: this.obstacles() };
  }

  /**
   * Screen furniture labels and badges must keep off. docs/DESIGN.md asks for
   * turn badges "nudged clear of car labels and controls", and the camera group
   * is the control that sits over the track.
   */
  private obstacles(): Obstacle[] {
    const group = this.canvas?.parentElement?.querySelector('.camera-group');
    const canvasBox = this.canvas?.getBoundingClientRect();
    if (!group || !canvasBox) return [];
    const b = group.getBoundingClientRect();
    return [
      {
        top: b.top - canvasBox.top,
        bottom: b.bottom - canvasBox.top,
        left: b.left - canvasBox.left,
        right: b.right - canvasBox.left,
      },
    ];
  }

  /** Each laid-out label's lift off its car this frame, in pixels. */
  private readonly labelLift = new Map<number, number>();
  private readonly camWorld = new THREE.Vector3();

  /** World units per screen pixel at a point, for turning offsets back. */
  private worldPerPixelAt(point: THREE.Vector3, heightPx: number): number {
    this.camera.getWorldPosition(this.camWorld);
    const dist = this.camWorld.distanceTo(point);
    const vfov = THREE.MathUtils.degToRad(this.camera.fov);
    return (2 * Math.tan(vfov / 2) * dist) / heightPx;
  }

  // ---------- bookkeeping ----------

  private own<T extends { dispose(): void }>(x: T): T {
    this.disposables.push(x);
    return x;
  }

  private add(group: THREE.Group, obj: THREE.Object3D): void {
    group.add(obj);
  }

  /**
   * Empty a group and give back what it held.
   *
   * `group.clear()` alone only detaches: the geometries, materials and canvas
   * textures keep their GPU allocations until the renderer is torn down. That
   * matters because the groups cleared here are rebuilt *while the app runs* —
   * the elevation slider and the layer toggles both call `setCircuit`, and the
   * flag and safety-car groups are rebuilt whenever race control changes its
   * mind — so a viewer playing with the elevation slider for a minute was
   * leaking a full set of track buffers per drag.
   *
   * Only the four built groups are ever passed here. Cars are not: their
   * geometry is shared across the field, which is what `SHARED_GEOMETRY`
   * guards against.
   */
  private clearGroup(group: THREE.Group): void {
    group.traverse((o) => {
      if (o === group) return;
      const m = o as Partial<THREE.Mesh> & { material?: THREE.Material | THREE.Material[] };
      if (m.geometry && !SHARED_GEOMETRY.has(m.geometry)) m.geometry.dispose();
      for (const mat of m.material ? (Array.isArray(m.material) ? m.material : [m.material]) : []) {
        const map = (mat as THREE.Material & { map?: THREE.Texture | null }).map;
        if (map) map.dispose();
        mat.dispose();
      }
    });
    group.clear();
  }
}
