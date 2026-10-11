// The 290px track area: the three.js canvas, the camera group and the race
// control line. The scene is imperative and mounts onto the canvas via a ref —
// per-frame data never passes through React.

import { useEffect, useRef } from 'react';
import { getScene, setScene } from '../scene/instance.js';
import { Scene, type CameraPreset } from '../scene/Scene.js';
import { useStore } from '../store/store.js';

/** Sentence case: race control shouts in capitals. */
function sentence(msg: string): string {
  return msg.charAt(0) + msg.slice(1).toLowerCase();
}

const PRESETS: Array<[CameraPreset, string]> = [
  ['map', 'Map'],
  ['tilt', 'Tilt'],
  ['chase', 'Chase'],
];

export function TrackArea(): React.JSX.Element {
  const ref = useRef<HTMLCanvasElement>(null);
  const select = useStore((s) => s.select);
  const rc = useStore((s) => s.timing?.rc?.[0]?.msg ?? null);
  const circuit = useStore((s) => s.circuit);
  const circuitEpoch = useStore((s) => s.circuitEpoch);
  const zx = useStore((s) => s.zx);
  const camera = useStore((s) => s.camera);
  const setCamera = useStore((s) => s.setCamera);

  useEffect(() => {
    if (!ref.current) return undefined;
    const scene = new Scene(ref.current);
    setScene(scene);
    return () => {
      setScene(null);
      scene.dispose();
    };
  }, []);

  // Rebuild the track when the outline, its transform or the elevation changes.
  useEffect(() => {
    getScene()?.setCircuit(circuit, zx);
  }, [circuit, circuitEpoch, zx]);

  useEffect(() => {
    getScene()?.setCamera(camera);
  }, [camera]);

  // Tap to select, ignoring drags, which are camera moves.
  const down = useRef<{ x: number; y: number } | null>(null);

  return (
    <section className="track" aria-label="Track">
      <canvas
        ref={ref}
        className="track-canvas"
        aria-label="3D track view with cars. Drag to rotate, pinch to zoom, tap a car to select it."
        onPointerDown={(e) => (down.current = { x: e.clientX, y: e.clientY })}
        onPointerUp={(e) => {
          const d = down.current;
          if (!d || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 8) return;
          const scene = getScene();
          if (!scene) return;
          const n = scene.pickCar(scene.ndcFor(e));
          if (n != null) select(n);
        }}
      />
      <div className="camera-group" role="group" aria-label="Camera">
        {PRESETS.map(([value, label]) => (
          <button
            key={value}
            className="camera-button"
            aria-pressed={value === camera}
            onClick={() => setCamera(value)}
          >
            {label}
          </button>
        ))}
      </div>
      {rc && <p className="race-control">{sentence(rc)}</p>}
    </section>
  );
}
