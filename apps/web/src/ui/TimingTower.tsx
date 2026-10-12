// The timing tower. Header row 30px, rows 36px, about nine visible at 390x844.
//
// Both of the rules this draws — which rows are in a battle, and what colour a
// lap time takes — are decided on the server in derive/ and arrive on the
// wire. They were worked out here until M4, which could not express either
// one correctly: a battle is about the interval whatever column is on show,
// and a lap colour is about the lap just completed, which the view cannot see.

import type { TrackFlag } from '@lapline/shared';
import { useStore } from '../store/store.js';
import { fmtGap, fmtLap, tyreVar, TYRE_LETTER } from './format.js';

/**
 * What the tower shows changes with the race state, per docs/DESIGN.md:116.
 * Under a safety car the last lap gives way to a count of stops, because the
 * field is circulating and nobody's lap time means anything; under a red flag
 * the gaps are the ones the order was frozen at and there are no lap times at
 * all.
 */
type TowerMode = 'racing' | 'neutralised' | 'red';

function towerMode(flag: TrackFlag): TowerMode {
  if (flag === 'RED') return 'red';
  if (flag === 'SC' || flag === 'SC ENDING' || flag === 'VSC' || flag === 'VSC ENDING') return 'neutralised';
  return 'racing';
}

export function TimingTower(): React.JSX.Element {
  const rows = useStore((s) => s.timing?.rows);
  const flag = useStore((s) => s.timing?.flag ?? 'GREEN');
  const battling = useStore((s) => s.timing?.battles);
  const drivers = useStore((s) => s.drivers);
  const sel = useStore((s) => s.sel);
  const gapMode = useStore((s) => s.gapMode);
  const setGapMode = useStore((s) => s.setGapMode);
  const select = useStore((s) => s.select);

  const list = rows ?? [];
  const inBattle = new Set(battling ?? []);
  const mode = towerMode(flag);

  return (
    <section className={`tower tower-${mode}`} aria-label="Timing">
      <div className="tower-head">
        <span className="col-pos">Pos</span>
        <span />
        <span>Driver</span>
        {mode === 'red' ? (
          // Nothing is moving, so there is nothing to toggle between.
          <span className="col-gap">Gap at red flag</span>
        ) : (
          <button className="gap-toggle" onClick={() => setGapMode(gapMode === 'int' ? 'gap' : 'int')}>
            {gapMode === 'int' ? 'Interval' : 'To leader'}
          </button>
        )}
        <span>Tyre</span>
        {mode === 'racing' && <span className="col-last">Last lap</span>}
        {mode === 'neutralised' && <span className="col-last">Pits</span>}
      </div>

      <ol className="tower-rows">
        {list.map((r) => {
          const d = drivers.get(r.n);
          // Under a red flag the order is frozen, and the gap to the leader
          // is the only one that still means anything.
          const value = mode === 'red' ? r.gap : gapMode === 'int' ? r.int : r.gap;
          return (
            <li
              key={r.n}
              className={`tower-row${r.n === sel ? ' is-selected' : ''}`}
              onClick={() => select(r.n)}
            >
              <span className="col-pos">{r.p ?? ''}</span>
              <span className="row-swatch" style={{ background: d?.colour ?? 'var(--haze)' }} />
              <span className="row-code">
                {d?.code ?? r.n}
                {r.pit && <span className="pit-badge">Pit</span>}
              </span>
              <span className={`row-gap${inBattle.has(r.n) ? ' is-battle' : ''}`}>{fmtGap(value, r.p)}</span>
              <span className="row-tyre">
                <span className="tyre-ring" style={{ borderColor: tyreVar(r.tyre), color: tyreVar(r.tyre) }}>
                  {r.tyre ? (TYRE_LETTER[r.tyre] ?? r.tyre[0]) : '?'}
                </span>
                {r.age ?? ''}
              </span>
              {mode === 'racing' && (
                <span className={`col-last${r.lapFlag ? (r.lapFlag === 'fastest' ? ' is-fastest' : ' is-pb') : ''}`}>
                  {fmtLap(r.last)}
                </span>
              )}
              {mode === 'neutralised' && <span className="col-last">{r.stops}</span>}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
