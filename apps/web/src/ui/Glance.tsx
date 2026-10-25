// Glance mode: the top five in large type beside a flat map.
//
// Built to design/artboards/Glance.dc.html. This is the phone propped up
// across the room while the race is on the television, so everything that
// needs looking at closely is gone: positions six and down, tyres, lap times,
// sectors, telemetry, every control but the one that leaves.
//
// The map is an SVG, not the 3D scene. It is meant to be flat and poor — one
// outline and five dots — and the circuit is already in the store, so a WebGL
// context for a still drawing would be spending a lot to gain nothing. The
// podium's backdrop in Finished.tsx is the same trade.

import { useEffect } from 'react';
import type { Circuit, TowerRow } from '@lapline/shared';
import { useStore } from '../store/store.js';
import { fastestBest, sessionKind, sessionLabel, timedGap } from './session.js';

/** The five rows the artboard shows, leader first. */
export function topFive(rows: readonly TowerRow[]): TowerRow[] {
  return [...rows]
    .filter((r) => r.p != null)
    .sort((a, b) => (a.p as number) - (b.p as number))
    .slice(0, 5);
}

/**
 * The interval, to one decimal.
 *
 * Three decimals is right in the tower, read at arm's length. From across a
 * room a tenth is all anyone can use, and the extra digits only make the
 * number longer to take in.
 */
export function glanceGap(row: TowerRow): string {
  if (row.p === 1) return 'Leader';
  if (typeof row.int === 'string') return row.int;
  if (typeof row.int !== 'number') return '–';
  return `+${row.int.toFixed(1)}`;
}

/** The outline as a flat path, in a 0-100 box. OpenF1's y grows the other way. */
export function flatPath(circuit: Circuit | null): { d: string; at: (p: readonly number[]) => [number, number] } | null {
  if (!circuit || circuit.points.length < 10) return null;
  const xs = circuit.points.map((p) => p[0]);
  const ys = circuit.points.map((p) => p[1]);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const span = Math.max(Math.max(...xs) - minX, Math.max(...ys) - minY) || 1;
  const at = (p: readonly number[]): [number, number] => [
    ((((p[0] as number) - minX) / span) * 100),
    100 - ((((p[1] as number) - minY) / span) * 100),
  ];
  const d = circuit.points
    .map((p, i) => {
      const [x, y] = at(p);
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join('');
  return { d: `${d}Z`, at };
}

export function Glance(): React.JSX.Element {
  const rows = useStore((s) => s.timing?.rows);
  const lap = useStore((s) => s.timing?.lap ?? null);
  const totalLaps = useStore((s) => s.timing?.totalLaps ?? null);
  const phase = useStore((s) => s.timing?.phase ?? null);
  const name = useStore((s) => s.session?.name);
  const drivers = useStore((s) => s.drivers);
  const sel = useStore((s) => s.sel);
  const circuit = useStore((s) => s.circuit);
  const tick = useStore((s) => s.tick);
  const mode = useStore((s) => s.mode);
  const setGlance = useStore((s) => s.setGlance);

  // Glance belongs to landscape. Rotating back to portrait leaves it, which
  // is the other half of "transient": there is no way to be stuck in it.
  useEffect(() => {
    const portrait = window.matchMedia('(orientation: portrait)');
    const check = (): void => {
      if (portrait.matches) setGlance(false);
    };
    check();
    portrait.addEventListener('change', check);
    return () => portrait.removeEventListener('change', check);
  }, [setGlance]);

  const five = topFive(rows ?? []);
  // Practice and qualifying gaps stay at three decimals even here: a pole is
  // often won by hundredths, and "+0.1" for 0.068 would be wrong, not short.
  const timed = sessionKind(name) !== 'race';
  const fastest = timed ? fastestBest(rows ?? []) : null;
  const label = sessionLabel(name, phase);
  const gapOf = (r: TowerRow): string => (timed ? timedGap(r, fastest) : glanceGap(r));
  const map = flatPath(circuit);
  const code = (n: number): string => drivers.get(n)?.code ?? String(n);
  const colour = (n: number): string => drivers.get(n)?.colour ?? 'var(--haze)';

  // Where the five leaders are, from the same tick the scene draws.
  const dots = map
    ? five
        .map((r) => {
          const car = tick?.cars.find((c) => c[0] === r.n);
          if (!car) return null;
          const [x, y] = map.at([car[1], car[2]]);
          return { n: r.n, x, y };
        })
        .filter((d): d is { n: number; x: number; y: number } => d != null)
    : [];

  const chosen = sel == null ? null : (rows?.find((r) => r.n === sel) ?? null);
  const speed = sel == null ? null : (tick?.cars.find((c) => c[0] === sel)?.[4] ?? null);

  return (
    <section className="glance" aria-label="Glance">
      <div className="glance-order" aria-label="Top five">
        {label ? (
          <p className="glance-lap">
            {label.text} {label.bold && <b>{label.bold}</b>}
          </p>
        ) : (
          <p className="glance-lap">
            Lap <b>{lap ?? '–'}</b>
            {totalLaps != null && <span className="glance-of">of {totalLaps}</span>}
          </p>
        )}
        <ol>
          {five.map((r) => (
            <li key={r.n} className={r.n === sel ? 'is-selected' : ''}>
              <span className="glance-pos">{r.p}</span>
              <span className="glance-swatch" style={{ background: colour(r.n) }} />
              <span className="glance-code">{code(r.n)}</span>
              <span className={`glance-gap${r.p === 1 ? ' is-leader' : ''}`}>{gapOf(r)}</span>
            </li>
          ))}
        </ol>
      </div>

      <div className="glance-map" aria-label="Track map">
        <div className="glance-top">
          {mode === 'live' && (
            <span className="glance-live">
              <span className="pill-dot" aria-hidden="true" />
              Live
            </span>
          )}
          <button className="icon-button" aria-label="Leave glance mode" onClick={() => setGlance(false)}>
            <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
              <path
                d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"
                stroke="currentColor"
                strokeWidth="2"
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>

        <svg viewBox="0 0 100 100" role="img" aria-label="Track map with the leaders highlighted">
          {map && <path d={map.d} className="glance-track" />}
          {dots.map((d) => (
            <circle key={d.n} cx={d.x} cy={d.y} r="2.4" fill={colour(d.n)} stroke="var(--night)" strokeWidth="0.6" />
          ))}
          {sel != null &&
            dots
              .filter((d) => d.n === sel)
              .map((d) => (
                <circle key="ring" cx={d.x} cy={d.y} r="3.9" fill="none" stroke="var(--flood)" strokeWidth="0.8" />
              ))}
        </svg>

        <p className="glance-following">
          {chosen ? (
            <>
              <span>Following </span>
              <b style={{ borderBottomColor: colour(chosen.n) }}>{code(chosen.n)}</b>
              <span> {speed != null ? `${speed} km/h` : ''}</span>
            </>
          ) : (
            <span>Tap a car to follow it</span>
          )}
        </p>
      </div>
    </section>
  );
}
