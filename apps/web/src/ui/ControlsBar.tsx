// The controls bar. 68px in live, as the artboard draws it.
//
// Replay gets its own artboard and about 90px at M6; until then its transport
// keeps working with the live bar's styling rather than regressing to nothing.

import { post } from '../stream/control.js';
import { useStore } from '../store/store.js';

function LiveControls(): React.JSX.Element {
  const delayS = useStore((s) => s.live?.delayS ?? 10);
  return (
    <>
      <span className="controls-label">
        Matching TV at <b>{delayS} s</b> behind
      </span>
      <button className="round-button" aria-label="One second less delay" onClick={() => void post({ delayS: delayS - 1 })}>
        −
      </button>
      <button className="round-button" aria-label="One second more delay" onClick={() => void post({ delayS: delayS + 1 })}>
        +
      </button>
      {/* The sync sheet is M6. */}
      <button className="primary-button" disabled>
        Sync
      </button>
    </>
  );
}

const SPEEDS = [1, 2, 4, 8, 16];

function ReplayControls(): React.JSX.Element {
  const replay = useStore((s) => s.replay);
  const t = useStore((s) => s.tick?.t ?? null);
  const scrubbing = useStore((s) => s.scrubbing);
  const setScrubbing = useStore((s) => s.setScrubbing);
  const clearHistory = useStore((s) => s.clearHistory);
  if (!replay) return <span className="controls-label">Loading…</span>;

  const { start, end, playing, speed } = replay;
  const elapsed = Math.max(0, (t ?? start) - start) / 1000;
  const h = Math.floor(elapsed / 3600);
  const m = Math.floor((elapsed % 3600) / 60);
  const s = Math.floor(elapsed % 60);

  return (
    <>
      <button className="round-button" aria-label={playing ? 'Pause' : 'Play'} onClick={() => void post({ playing: !playing })}>
        {playing ? '❙❙' : '▶'}
      </button>
      <span className="controls-clock">{`${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`}</span>
      <input
        className="scrub"
        type="range"
        min={0}
        max={1000}
        aria-label="Replay position"
        value={scrubbing ? undefined : Math.round((((t ?? start) - start) / (end - start)) * 1000)}
        onInput={() => setScrubbing(true)}
        onChange={(e) => {
          setScrubbing(false);
          void post({ at: start + (Number(e.currentTarget.value) / 1000) * (end - start) });
          clearHistory();
        }}
      />
      <button
        className="round-button wide"
        onClick={() => void post({ speed: SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length] })}
      >
        {speed}×
      </button>
    </>
  );
}

export function ControlsBar(): React.JSX.Element | null {
  const mode = useStore((s) => s.mode);
  if (mode !== 'live' && mode !== 'replay') return null;
  return <footer className="controls">{mode === 'live' ? <LiveControls /> : <ReplayControls />}</footer>;
}
