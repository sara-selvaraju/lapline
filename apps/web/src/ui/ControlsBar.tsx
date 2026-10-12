// The controls bar. 68px in live and about 90 in replay, as the artboards
// draw them: live is one row, replay is a scrubber row above a transport row.

import { post } from '../stream/control.js';
import { useStore } from '../store/store.js';
import { fmtDuration } from './format.js';

function LiveControls(): React.JSX.Element {
  const delayS = useStore((s) => s.live?.delayS ?? 10);
  const openSync = useStore((s) => s.openSync);
  const setDelay = useStore((s) => s.setDelay);

  return (
    <>
      <span className="controls-label">
        Matching TV at <b>{delayS} s</b> behind
      </span>
      <button className="round-button" aria-label="One second less delay" onClick={() => setDelay(delayS - 1)}>
        −
      </button>
      <button className="round-button" aria-label="One second more delay" onClick={() => setDelay(delayS + 1)}>
        +
      </button>
      <button className="primary-button" onClick={openSync}>
        Sync
      </button>
    </>
  );
}

const SPEEDS = [1, 2, 4, 8, 16];
/** docs/DESIGN.md: the transport jumps by ten seconds. */
const NUDGE_MS = 10_000;

/**
 * The periods the scrubber marks, as percentages across the session.
 *
 * docs/DESIGN.md: safety car in yellow, VSC in dim yellow, a red flag as a
 * tick rather than a band — a stoppage is a moment to find, not a stretch to
 * measure.
 */
function ScrubMarkers({ start, end }: { start: number; end: number }): React.JSX.Element | null {
  const periods = useStore((s) => s.periods);
  const span = end - start;
  if (!periods?.length || span <= 0) return null;

  return (
    <>
      {periods.map((p) => {
        const from = Math.max(0, Math.min(100, ((p.from - start) / span) * 100));
        const to = Math.max(0, Math.min(100, (((p.to ?? end) - start) / span) * 100));
        if (p.flag === 'RED') {
          return <span key={`${p.flag}${p.from}`} className="scrub-red" style={{ left: `${from}%` }} />;
        }
        return (
          <span
            key={`${p.flag}${p.from}`}
            className={`scrub-period${p.flag.startsWith('VSC') ? ' is-vsc' : ''}`}
            style={{ left: `${from}%`, width: `${Math.max(0.8, to - from)}%` }}
          />
        );
      })}
    </>
  );
}

function ReplayControls(): React.JSX.Element {
  const replay = useStore((s) => s.replay);
  const t = useStore((s) => s.tick?.t ?? null);
  const scrubbing = useStore((s) => s.scrubbing);
  const setScrubbing = useStore((s) => s.setScrubbing);
  const clearHistory = useStore((s) => s.clearHistory);
  if (!replay) return <span className="controls-label">Loading…</span>;

  const { start, end, playing, speed } = replay;
  const at = t ?? start;
  const elapsed = Math.max(0, at - start) / 1000;
  const total = Math.max(0, end - start) / 1000;
  const seek = (to: number): void => {
    void post({ at: Math.max(start, Math.min(end, to)) });
    clearHistory();
  };

  return (
    <>
      <div className="scrub-row">
        <span className="scrub-track" aria-hidden="true" />
        <span
          className="scrub-progress"
          aria-hidden="true"
          style={{ width: `${Math.max(0, Math.min(100, ((at - start) / (end - start)) * 100))}%` }}
        />
        <ScrubMarkers start={start} end={end} />
        <input
          className="scrub"
          type="range"
          min={0}
          max={1000}
          aria-label="Replay position. Yellow marks a safety car, red marks a red flag."
          value={scrubbing ? undefined : Math.round(((at - start) / (end - start)) * 1000)}
          onInput={() => setScrubbing(true)}
          onChange={(e) => {
            setScrubbing(false);
            seek(start + (Number(e.currentTarget.value) / 1000) * (end - start));
          }}
        />
      </div>

      <div className="transport-row">
        <button
          className="play-button"
          aria-label={playing ? 'Pause' : 'Play'}
          onClick={() => void post({ playing: !playing })}
        >
          {playing ? '❙❙' : '▶'}
        </button>
        <button className="step-button" aria-label="Back 10 seconds" onClick={() => seek(at - NUDGE_MS)}>
          −10 s
        </button>
        <button className="step-button" aria-label="Forward 10 seconds" onClick={() => seek(at + NUDGE_MS)}>
          +10 s
        </button>
        <div className="transport-clock">
          <span className="controls-clock">{fmtDuration(elapsed)}</span>
          <span className="transport-total">of {fmtDuration(total)}</span>
        </div>
        <button
          className="speed-button"
          aria-label="Playback speed"
          onClick={() => void post({ speed: SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length] })}
        >
          {speed}×
        </button>
      </div>
    </>
  );
}

export function ControlsBar(): React.JSX.Element | null {
  const mode = useStore((s) => s.mode);
  if (mode !== 'live' && mode !== 'replay') return null;
  return (
    <footer className={`controls controls-${mode}`}>
      {mode === 'live' ? <LiveControls /> : <ReplayControls />}
    </footer>
  );
}
