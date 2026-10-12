// The selected car, at a glance. 88px.
//
// This is the one component that shows per-frame values, so it is deliberately
// small: it selects only the fields it draws, and a 4 Hz re-render of this much
// markup is cheap. The expanded telemetry panel behind the chevron is M4.

import type { CarTuple } from '@lapline/shared';
import { useStore } from '../store/store.js';
import { TYRE_LETTER, fmtGap, tyreVar } from './format.js';

export function DriverStrip(): React.JSX.Element {
  const sel = useStore((s) => s.sel);
  const driver = useStore((s) => (s.sel == null ? undefined : s.drivers.get(s.sel)));
  const row = useStore((s) => (s.sel == null ? undefined : s.timingByN.get(s.sel)));
  const gapMode = useStore((s) => s.gapMode);
  // One selector, one array reference per frame, rather than four subscriptions.
  const car = useStore((s) => (s.sel == null ? undefined : s.tick?.cars.find((c) => c[0] === s.sel))) as
    | CarTuple
    | undefined;

  const speed = car?.[4] ?? null;
  const gear = car?.[5] ?? null;
  const throttle = car?.[7] ?? 0;
  const brake = car?.[8] ?? 0;

  return (
    <section className="strip" aria-label="Selected driver">
      <span className="strip-swatch" style={{ background: driver?.colour ?? 'var(--haze)' }} />

      <div className="strip-who">
        <span className="strip-pos">{row?.p ? `P${row.p}` : '–'}</span>
        <span className="strip-code">{driver?.code ?? (sel == null ? 'Tap a car' : String(sel))}</span>
        <span className="strip-gap">{row ? fmtGap(gapMode === 'int' ? row.int : row.gap, row.p) : '–'}</span>
      </div>

      <div className="strip-speed">
        <span className="strip-speed-value">{speed ?? '–'}</span>
        <span className="strip-unit">km/h</span>
      </div>

      <div className="strip-gear">
        <span className="strip-gear-value">{gear ? gear : car ? 'N' : '–'}</span>
        <span className="strip-unit">gear</span>
      </div>

      <div className="strip-bars">
        <div className="bar" aria-label={`Throttle ${Math.round(throttle)} percent`}>
          <div className="bar-fill bar-throttle" style={{ width: `${Math.max(0, Math.min(100, throttle))}%` }} />
        </div>
        <div className="bar" aria-label={brake ? 'Braking' : 'Brake off'}>
          <div className="bar-fill bar-brake" style={{ width: `${brake ? Math.min(100, brake) : 0}%` }} />
        </div>
        <span className="strip-tyre">
          <span className="tyre-ring" style={{ borderColor: tyreVar(row?.tyre ?? null), color: tyreVar(row?.tyre ?? null) }}>
            {row?.tyre ? (TYRE_LETTER[row.tyre] ?? row.tyre[0]) : '?'}
          </span>
          {row?.age != null ? `${row.age} laps` : ''}
        </span>
      </div>

      {/* The telemetry panel this opens is M4. */}
      <button className="icon-button" aria-label="Show telemetry" disabled>
        <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M6 15l6-6 6 6" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
    </section>
  );
}
