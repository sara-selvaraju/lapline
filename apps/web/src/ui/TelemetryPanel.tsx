// The expanded telemetry panel, behind the driver strip's chevron.
//
// Built to design/artboards/DriverDetail.dc.html, which is the source of
// truth for every size here. The track above shrinks to make room, which is
// why this is a sibling of the strip rather than a sheet over the top: the
// viewer is still watching the cars.

import type { CarTuple } from '@lapline/shared';
import { useStore } from '../store/store.js';
import { fmtBehind, fmtGap, fmtLap, TYRE_LETTER, tyreVar } from './format.js';
import { SpeedTrace } from './SpeedTrace.js';

/**
 * Full scale for the RPM bar. The artboard draws 11.2k at 86%, and 2026 cars
 * do not see much past this.
 */
const MAX_RPM = 13_000;

export function TelemetryPanel(): React.JSX.Element | null {
  const sel = useStore((s) => s.sel);
  const driver = useStore((s) => (s.sel == null ? undefined : s.drivers.get(s.sel)));
  const row = useStore((s) => (s.sel == null ? undefined : s.timingByN.get(s.sel)));
  const rows = useStore((s) => s.timing?.rows);
  const drivers = useStore((s) => s.drivers);
  const selectByOffset = useStore((s) => s.selectByOffset);
  const setExpanded = useStore((s) => s.setExpanded);
  // One selector, so this whole panel costs one array lookup per frame.
  const car = useStore((s) => (s.sel == null ? undefined : s.tick?.cars.find((c) => c[0] === s.sel))) as
    | CarTuple
    | undefined;

  if (sel == null) return null;

  const speed = car?.[4] ?? null;
  const gear = car?.[5] ?? null;
  const rpm = car?.[6] ?? null;
  const throttle = car?.[7] ?? 0;
  const brake = car?.[8] ?? 0;

  // The cars either side in the running order, and what separates them.
  const list = rows ?? [];
  const at = list.findIndex((r) => r.n === sel);
  const ahead = at > 0 ? list[at - 1] : undefined;
  const behind = at >= 0 && at < list.length - 1 ? list[at + 1] : undefined;
  const codeOf = (n: number | undefined): string => (n == null ? '–' : (drivers.get(n)?.code ?? String(n)));

  return (
    <section className="telemetry" aria-label={`${driver?.code ?? sel} telemetry`}>
      <div className="tel-head">
        <span className="tel-swatch" style={{ background: driver?.colour ?? 'var(--haze)' }} />
        <div className="tel-who">
          <span className="tel-name">
            {row?.p ? `P${row.p} ` : ''}
            {driver?.code ?? sel}
          </span>
          <span className="tel-full">
            {[driver?.name, driver?.team].filter(Boolean).join(', ') || 'Unknown driver'}
          </span>
        </div>
        <button
          className="tel-step"
          aria-label="Show the car ahead"
          disabled={!ahead}
          onClick={() => selectByOffset(-1)}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M6 15l6-6 6 6" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <button
          className="tel-step"
          aria-label="Show the car behind"
          disabled={!behind}
          onClick={() => selectByOffset(1)}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <button className="icon-button" aria-label="Collapse telemetry" onClick={() => setExpanded(false)}>
          <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      <div className="tel-now">
        <div className="tel-big">
          <span className="tel-big-value">{speed ?? '–'}</span>
          <span className="tel-unit">km/h</span>
        </div>
        <div className="tel-big tel-big-gear">
          <span className="tel-big-value tel-gear-value">{gear ? gear : car ? 'N' : '–'}</span>
          <span className="tel-unit">gear</span>
        </div>
        <div className="tel-bars">
          <Bar label="Throttle" pct={throttle} value={`${Math.round(throttle)}%`} fill="bar-throttle" />
          <Bar label="Brake" pct={brake} value={brake ? 'On' : 'Off'} fill="bar-brake" />
          <Bar
            label="RPM"
            pct={rpm == null ? 0 : (rpm / MAX_RPM) * 100}
            value={rpm == null ? '–' : `${(rpm / 1000).toFixed(1)}k`}
            fill="bar-rpm"
          />
        </div>
      </div>

      <SpeedTrace />

      <dl className="tel-stats">
        <Stat
          label={ahead ? `To ${codeOf(ahead.n)} ahead` : 'Car ahead'}
          value={ahead ? fmtGap(row?.int ?? null, row?.p) : 'Leading'}
        />
        <Stat
          label={behind ? `${codeOf(behind.n)} behind` : 'Car behind'}
          value={behind ? fmtBehind(behind.int) : '–'}
        />
        <Stat label="To leader" value={row?.p === 1 ? 'Leader' : fmtGap(row?.gap ?? null, row?.p)} />
        <Stat label="Last lap" value={fmtLap(row?.last ?? null)} />
        <Stat label="Best lap" value={fmtLap(row?.best ?? null)} />
        <Stat
          label="Tyre"
          value={
            <span className="tel-tyre">
              <span
                className="tyre-ring"
                style={{ borderColor: tyreVar(row?.tyre ?? null), color: tyreVar(row?.tyre ?? null) }}
              >
                {row?.tyre ? (TYRE_LETTER[row.tyre] ?? row.tyre[0]) : '?'}
              </span>
              {row?.age != null ? `${row.age} laps` : ''}
            </span>
          }
        />
      </dl>
    </section>
  );
}

function Bar({
  label,
  pct,
  value,
  fill,
}: {
  label: string;
  pct: number;
  value: string;
  fill: string;
}): React.JSX.Element {
  return (
    <div className="tel-bar-row">
      <span>{label}</span>
      <div className="bar">
        <div className={`bar-fill ${fill}`} style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
      </div>
      <span className="tel-bar-value">{value}</span>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }): React.JSX.Element {
  return (
    <div className="tel-stat">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
