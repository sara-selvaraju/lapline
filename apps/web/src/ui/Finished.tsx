// The finished session: podium, fastest lap and the final classification.
//
// Built to design/artboards/Finished.dc.html, which drops the track and the
// driver strip entirely. Nothing here moves, so nothing here subscribes to
// ticks: it is drawn from the classification the server fetched once.

import type { ResultRow, SessionResult } from '@lapline/shared';
import { useStore } from '../store/store.js';
import { fmtClock, fmtGap, fmtLap } from './format.js';

/** The podium cards, at the artboard's deliberately unequal heights. */
const STEPS: Array<{ position: number; title: string; className: string }> = [
  { position: 2, title: 'Second', className: 'step-second' },
  { position: 1, title: 'Winner', className: 'step-first' },
  { position: 3, title: 'Third', className: 'step-third' },
];

export function Finished(): React.JSX.Element | null {
  const result = useStore((s) => s.result);
  const drivers = useStore((s) => s.drivers);
  const openPicker = useStore((s) => s.openSessions);
  const replay = useStore((s) => s.replayFromStart);

  if (!result) return null;
  const code = (n: number): string => drivers.get(n)?.code ?? String(n);
  const colour = (n: number): string => drivers.get(n)?.colour ?? 'var(--haze)';

  return (
    <>
      <section className="podium" aria-label="Podium">
        <PodiumBackdrop />
        <div className="podium-steps">
          {STEPS.map((step) => {
            const row = result.rows.find((r) => r.position === step.position);
            if (!row) return <div key={step.position} />;
            return (
              <div key={step.position} className={`step ${step.className}`}>
                <span className="step-title">{step.title}</span>
                <span className="step-code" style={{ borderBottomColor: colour(row.n) }}>
                  {code(row.n)}
                </span>
                <span className="step-gap">
                  {step.position === 1 ? fmtClock(result.winnerTime) : fmtGap(row.gap, null)}
                </span>
              </div>
            );
          })}
        </div>
      </section>

      <p className="fastest-line">
        {result.fastest ? (
          <>
            Fastest lap{' '}
            <b>
              {code(result.fastest.n)} {fmtLap(result.fastest.time)}
            </b>
            {result.fastest.lap != null ? `, lap ${result.fastest.lap}` : ''}
          </>
        ) : (
          'No fastest lap recorded'
        )}
      </p>

      <section className="tower tower-finished" aria-label="Final classification">
        <div className="tower-head">
          <span className="col-pos">Pos</span>
          <span />
          <span>Driver</span>
          <span className="col-gap">Gap to winner</span>
          <span className="col-stops">Stops</span>
        </div>
        <ol className="tower-rows">
          {result.rows.map((r) => (
            <ClassificationRow key={r.n} row={r} code={code(r.n)} colour={colour(r.n)} result={result} />
          ))}
        </ol>
      </section>

      <footer className="finished-bar">
        <button className="button-outline" onClick={openPicker}>
          Choose a session
        </button>
        <button className="button-primary" onClick={replay}>
          Replay the race
        </button>
      </footer>
    </>
  );
}

/**
 * The circuit, very faint, behind the podium.
 *
 * Finished.dc.html keeps the outline there at low opacity, so the screen
 * still says which circuit this was. Drawn flat rather than through the 3D
 * scene: nothing moves any more, and a whole WebGL context for a still
 * background is not a trade worth making on a phone.
 */
function PodiumBackdrop(): React.JSX.Element | null {
  const circuit = useStore((s) => s.circuit);
  if (!circuit || circuit.points.length < 10) return null;

  const xs = circuit.points.map((p) => p[0]);
  const ys = circuit.points.map((p) => p[1]);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const span = Math.max(Math.max(...xs) - minX, Math.max(...ys) - minY) || 1;
  // OpenF1's y grows the opposite way to an SVG's, so it is flipped here.
  const d = circuit.points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${(((p[0] - minX) / span) * 100).toFixed(1)} ${(100 - ((p[1] - minY) / span) * 100).toFixed(1)}`)
    .join('');

  return (
    <svg className="podium-track" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      <path d={`${d}Z`} />
    </svg>
  );
}

function ClassificationRow({
  row,
  code,
  colour,
  result,
}: {
  row: ResultRow;
  code: string;
  colour: string;
  result: SessionResult;
}): React.JSX.Element {
  const stops = useStore((s) => s.timingByN.get(row.n)?.stops ?? null);
  // The winner's cell carries the total race time; everyone else a gap.
  const gap =
    row.status !== 'finished'
      ? row.status === 'dnf'
        ? 'Did not finish'
        : row.status === 'dns'
          ? 'Did not start'
          : 'Disqualified'
      : row.position === 1
        ? fmtClock(result.winnerTime)
        : fmtGap(row.gap, null);

  return (
    <li className="tower-row">
      <span className="col-pos">{row.position ?? ''}</span>
      <span className="row-swatch" style={{ background: colour }} />
      <span className="row-code">{code}</span>
      <span className={`col-gap${row.status === 'finished' ? '' : ' is-out'}`}>{gap}</span>
      <span className="col-stops">{stops ?? ''}</span>
    </li>
  );
}
