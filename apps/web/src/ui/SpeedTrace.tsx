// The 30-second speed trace, with braking marked along the bottom.

import { useStore } from '../store/store.js';
import { BRAKE_H, BRAKE_Y, GRID, TRACE_H, TRACE_W, traceShape } from './trace.js';

export function SpeedTrace(): React.JSX.Element {
  const history = useStore((s) => s.history);
  const { path, braking, filled } = traceShape(history);

  return (
    <figure className="tel-trace">
      <figcaption>
        <span>Speed, last 30 s</span>
        <span>
          <span className="trace-key" aria-hidden="true" />
          braking
        </span>
      </figcaption>
      <svg
        viewBox={`0 0 ${TRACE_W} ${TRACE_H}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={
          path
            ? `Speed over the last ${Math.round(filled * 30)} seconds, with ${braking.length} braking zones`
            : 'Speed trace, still filling'
        }
      >
        {GRID.map((g) => (
          <g key={g.speed}>
            <line x1="0" y1={g.y} x2={TRACE_W} y2={g.y} className="trace-grid" />
            <text x={TRACE_W - 2} y={g.y - 4} className="trace-grid-label">
              {g.speed}
            </text>
          </g>
        ))}
        {path && <path d={path} className="trace-line" />}
        {braking.map(([x, w], i) => (
          <rect key={i} x={x} y={BRAKE_Y} width={w} height={BRAKE_H} rx="2" className="trace-brake" />
        ))}
      </svg>
      {/* The feed is broadcast, so the server cannot backfill one viewer's
          car: after a load, a seek or a change of driver the window fills in
          real time. Saying so beats an empty box that looks broken. */}
      {filled < 0.9 && <span className="trace-note">Filling…</span>}
    </figure>
  );
}
