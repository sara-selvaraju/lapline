// The timing tower. Header row 30px, rows 36px, about nine visible at 390x844.
//
// docs/DESIGN.md's lap-time rule: haze by default, purple only for the session's
// fastest lap and pb only for a personal best, each on the lap just completed.
// The "lap just completed" half of that needs per-lap state the protocol does
// not carry yet, so M1 colours on value alone and M4 completes it.

import { useStore } from '../store/store.js';
import { fmtGap, fmtLap, TYRE_LETTER } from './format.js';

const tyreVar = (compound: string | null): string => {
  const key = (compound ?? '').toLowerCase();
  if (key === 'intermediate') return 'var(--tyre-inter)';
  if (key === 'soft' || key === 'medium' || key === 'hard' || key === 'wet') return `var(--tyre-${key})`;
  return 'var(--haze)';
};

/** An interval under a second, under green only, reads as a battle. */
const BATTLE_S = 1.0;

export function TimingTower(): React.JSX.Element {
  const rows = useStore((s) => s.timing?.rows);
  const flag = useStore((s) => s.timing?.flag ?? 'GREEN');
  const drivers = useStore((s) => s.drivers);
  const sel = useStore((s) => s.sel);
  const gapMode = useStore((s) => s.gapMode);
  const setGapMode = useStore((s) => s.setGapMode);
  const select = useStore((s) => s.select);

  const list = rows ?? [];
  const bestOverall = Math.min(...list.map((r) => r.best ?? Infinity));

  return (
    <section className="tower" aria-label="Timing">
      <div className="tower-head">
        <span className="col-pos">Pos</span>
        <span />
        <span>Driver</span>
        <button className="gap-toggle" onClick={() => setGapMode(gapMode === 'int' ? 'gap' : 'int')}>
          {gapMode === 'int' ? 'Interval' : 'To leader'}
        </button>
        <span>Tyre</span>
        <span className="col-last">Last lap</span>
      </div>

      <ol className="tower-rows">
        {list.map((r) => {
          const d = drivers.get(r.n);
          const value = gapMode === 'int' ? r.int : r.gap;
          const battle = flag === 'GREEN' && typeof value === 'number' && value > 0 && value < BATTLE_S;
          const fastest = r.last != null && r.last === bestOverall;
          const personal = !fastest && r.last != null && r.last === r.best;
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
              <span className={`row-gap${battle ? ' is-battle' : ''}`}>{fmtGap(value, r.p)}</span>
              <span className="row-tyre">
                <span className="tyre-ring" style={{ borderColor: tyreVar(r.tyre), color: tyreVar(r.tyre) }}>
                  {r.tyre ? (TYRE_LETTER[r.tyre] ?? r.tyre[0]) : '?'}
                </span>
                {r.age ?? ''}
              </span>
              <span className={`col-last${fastest ? ' is-fastest' : personal ? ' is-pb' : ''}`}>{fmtLap(r.last)}</span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
