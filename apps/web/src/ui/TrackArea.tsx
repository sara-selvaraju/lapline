// The 290px track area: the three.js canvas, the camera group and the race
// control line. The scene is imperative and mounts onto the canvas via a ref —
// per-frame data never passes through React.

import { useEffect, useRef } from 'react';
import { pickCarAt } from '../scene/cars.js';
import { camera, ndcFor, startScene, stopScene } from '../scene/scene.js';
import { useStore } from '../store/store.js';

/** Sentence case: race control shouts in capitals. */
function sentence(msg: string): string {
  return msg.charAt(0) + msg.slice(1).toLowerCase();
}

const PRESETS = ['Map', 'Tilt', 'Chase'] as const;

export function TrackArea(): React.JSX.Element {
  const ref = useRef<HTMLCanvasElement>(null);
  const select = useStore((s) => s.select);
  const rc = useStore((s) => s.timing?.rc?.[0]?.msg ?? null);

  useEffect(() => {
    if (ref.current) startScene(ref.current);
    return () => stopScene();
  }, []);

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
          const n = pickCarAt(ndcFor(e), camera);
          if (n != null) select(n);
        }}
      />
      {/* Camera presets are drawn now and wired up in M2, where the cameras exist. */}
      <div className="camera-group" role="group" aria-label="Camera">
        {PRESETS.map((p) => (
          <button key={p} className="camera-button" aria-pressed={p === 'Tilt'} disabled>
            {p}
          </button>
        ))}
      </div>
      {rc && <p className="race-control">{sentence(rc)}</p>}
    </section>
  );
}
