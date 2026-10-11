// The car picker, from CarPicker.dc.html.
//
// A tap into a train of cars is genuinely ambiguous, so rather than guessing
// which one was meant the scene hands over everything it hit and the viewer
// chooses. Rows are 48px, which is above the 44px minimum target.

import { useStore } from '../store/store.js';
import { fmtGap } from './format.js';

export function CarPicker(): React.JSX.Element | null {
  const picker = useStore((s) => s.picker);
  const drivers = useStore((s) => s.drivers);
  const timingByN = useStore((s) => s.timingByN);
  const gapMode = useStore((s) => s.gapMode);
  const sel = useStore((s) => s.sel);
  const select = useStore((s) => s.select);
  const close = useStore((s) => s.closePicker);

  if (!picker || picker.length === 0) return null;

  // Running order, so the list reads the way the tower does.
  const ordered = [...picker].sort((a, b) => (timingByN.get(a)?.p ?? 99) - (timingByN.get(b)?.p ?? 99));

  return (
    <>
      <button className="picker-scrim" aria-label="Close the list" onClick={close} />
      <div className="picker" role="dialog" aria-label="Cars near your tap">
        <span className="picker-head">{ordered.length} cars here. Pick one.</span>
        {ordered.map((n) => {
          const d = drivers.get(n);
          const row = timingByN.get(n);
          return (
            <button
              key={n}
              className={`picker-row${n === sel ? ' is-selected' : ''}`}
              onClick={() => select(n)}
            >
              <span className="picker-swatch" style={{ background: d?.colour ?? 'var(--haze)' }} />
              <span className="picker-pos">{row?.p ? `P${row.p}` : '–'}</span>
              <span className="picker-code">{d?.code ?? n}</span>
              <span className="picker-gap">
                {row ? fmtGap(gapMode === 'int' ? row.int : row.gap, row.p) : '–'}
              </span>
            </button>
          );
        })}
      </div>
    </>
  );
}
