// Sprites drawn at a fixed size on screen.
//
// docs/DESIGN.md gives car labels, badges and chips in pixels, and they are
// read as text, not as objects in the world. Sized in world units they were
// right only at the Tilt distance: the chase camera sits about a fifth as far
// away, and a 13px label came out at 64 to 91px, while the collision pass went
// on judging them at 13. So these sprites switch off size attenuation and the
// scene converts their pixel size each frame, which also keeps them right
// through a resize or a rotation.

import * as THREE from 'three';

interface PixelSize {
  width: number;
  height: number;
}

/** Marks a sprite as drawn at this many CSS pixels, whatever its depth. */
export function setPixelSize(sprite: THREE.Sprite, width: number, height: number): void {
  sprite.userData.px = { width, height } satisfies PixelSize;
  sprite.material.sizeAttenuation = false;
}

/** Sizes a sprite to its canvas texture, as `labelTexture` and friends record it. */
export function fitToTexture(sprite: THREE.Sprite, tex: THREE.Texture): void {
  const h = tex.userData.heightPx as number;
  setPixelSize(sprite, h * (tex.userData.aspect as number), h);
}

/** The sprite's size on screen in CSS pixels, or null if it is world-sized. */
export function pixelSize(sprite: THREE.Object3D): PixelSize | null {
  return (sprite.userData.px as PixelSize | undefined) ?? null;
}

/**
 * How far the sprite is drawn above its position, in pixels, from its centre.
 * A label is lifted off its car this way, so the lift is in screen space and
 * does not depend on how far away the camera is or which way it looks.
 */
export function setLiftPx(sprite: THREE.Sprite, px: number): void {
  const size = pixelSize(sprite);
  if (!size || size.height === 0) return;
  sprite.center.set(0.5, 0.5 - px / size.height);
}

export function liftPx(sprite: THREE.Sprite): number {
  const size = pixelSize(sprite);
  return size ? (0.5 - sprite.center.y) * size.height : 0;
}

/**
 * Converts every pixel-sized sprite under `root` into the units three.js
 * wants with attenuation off: a fraction of the view's height, scaled by the
 * projection. Cheap enough to run every frame for a few dozen sprites.
 */
export function applyPixelSizes(root: THREE.Object3D, camera: THREE.PerspectiveCamera, heightPx: number): void {
  if (heightPx <= 0) return;
  const unit = (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)) / (camera.zoom * heightPx);
  root.traverse((o) => {
    const size = pixelSize(o);
    if (size) o.scale.set(size.width * unit, size.height * unit, 1);
  });
}
