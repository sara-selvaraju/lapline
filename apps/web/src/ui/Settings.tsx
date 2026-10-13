// Settings: which session, what to watch, and how the track is drawn.
//
// Built to design/artboards/Settings.dc.html, which draws a full-screen page
// rather than a sheet. It absorbs M5's small session picker, which said in its
// own header that this is where it belonged.
//
// One departure, recorded under open design questions in docs/DESIGN.md: the
// three detail-layer toggles are here, in the Track view card. The artboard
// does not draw them, but docs/DESIGN.md calls each one a viewer preference
// and they have been stored and persisted since M3 with nothing able to
// change them. A preference nobody can reach is not a preference.

import { useEffect, useRef, useState } from 'react';
import type { SessionListEntry } from '@lapline/shared';
import { useStore } from '../store/store.js';
import { fmtWhen } from './format.js';

/** Sessions grouped by weekend, newest weekend first, as the artboard lists them. */
export function byWeekend(sessions: readonly SessionListEntry[]): Array<{
  meeting: string;
  key: number | null;
  sessions: SessionListEntry[];
}> {
  const groups = new Map<string, { meeting: string; key: number | null; sessions: SessionListEntry[] }>();
  for (const s of sessions) {
    const id = String(s.meetingKey ?? s.meeting);
    const group = groups.get(id) ?? { meeting: s.meeting, key: s.meetingKey, sessions: [] };
    group.sessions.push(s);
    groups.set(id, group);
  }
  return [...groups.values()];
}

/**
 * Frames a second, sampled only while the settings page is open.
 *
 * "60 fps on the target iPhone" has been unverified since M2 because there is
 * no device here, and headless Chrome says nothing about Safari on A-series
 * hardware. This puts the real number where it can be read off the phone
 * itself. It is a second's average, published once a second — per-frame data
 * does not go through React state.
 *
 * Not in the artboard; recorded under open design questions in docs/DESIGN.md.
 */
function useFps(active: boolean): number | null {
  const [fps, setFps] = useState<number | null>(null);
  const raf = useRef(0);
  useEffect(() => {
    if (!active) {
      setFps(null);
      return;
    }
    let frames = 0;
    let since = performance.now();
    const tick = (now: number): void => {
      frames++;
      if (now - since >= 1000) {
        setFps(Math.round((frames * 1000) / (now - since)));
        frames = 0;
        since = now;
      }
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [active]);
  return fps;
}

export function Settings(): React.JSX.Element | null {
  const open = useStore((s) => s.settingsOpen);
  const close = useStore((s) => s.closeSettings);
  const sessions = useStore((s) => s.sessions);
  const current = useStore((s) => s.session?.key ?? null);
  const chooseSession = useStore((s) => s.chooseSession);
  const replayFromStart = useStore((s) => s.replayFromStart);
  const fps = useFps(open);
  const status = useStore((s) => s.status);
  const mode = useStore((s) => s.mode);
  const stalled = useStore((s) => s.stalled);

  const followLive = useStore((s) => s.followLive);
  const setFollowLive = useStore((s) => s.setFollowLive);
  const keepAwake = useStore((s) => s.keepAwake);
  const setKeepAwake = useStore((s) => s.setKeepAwake);
  const allLabels = useStore((s) => s.allLabels);
  const setAllLabels = useStore((s) => s.setAllLabels);
  const zx = useStore((s) => s.zx);
  const setZx = useStore((s) => s.setZx);
  const showTurns = useStore((s) => s.showTurns);
  const showSectors = useStore((s) => s.showSectors);
  const showPitLane = useStore((s) => s.showPitLane);
  const setLayer = useStore((s) => s.setLayer);

  const [showAll, setShowAll] = useState(false);

  if (!open) return null;
  const weekends = byWeekend(sessions);
  const shown = showAll ? weekends : weekends.slice(0, 1);

  return (
    <div className="settings" role="dialog" aria-modal="true" aria-label="Settings">
      <header className="settings-head">
        <h1>Settings</h1>
        <button className="sheet-done" onClick={close}>
          Done
        </button>
      </header>

      <div className="settings-body">
        {shown.map((group, i) => (
          <section key={group.key ?? group.meeting} aria-label={`Sessions at ${group.meeting}`}>
            <h2 className="settings-heading">
              {group.meeting}
              {i === 0 ? ', this weekend' : ''}
            </h2>
            <div className="card" role="radiogroup" aria-label={group.meeting}>
              {group.sessions.map((s) => (
                <label key={s.key} className="card-row">
                  <input
                    type="radio"
                    name="session"
                    checked={s.key === current}
                    onChange={() => chooseSession(s.key)}
                  />
                  <span className="row-main">{s.name}</span>
                  <span className={`row-meta${s.live ? ' is-live' : ''}`}>
                    {s.live ? 'Live now' : fmtWhen(s.start)}
                  </span>
                </label>
              ))}
            </div>
          </section>
        ))}
        {weekends.length > 1 && (
          <button className="settings-more" onClick={() => setShowAll((v) => !v)}>
            {showAll ? 'This weekend only' : 'Earlier weekends'}
          </button>
        )}

        <section className="card" aria-label="Watching">
          <Toggle
            label="Jump to live sessions"
            note="Switch automatically when a session starts"
            checked={followLive}
            onChange={setFollowLive}
          />
          <Toggle
            label="Keep the screen on"
            note={keepAwake && !('wakeLock' in navigator) ? 'This browser cannot keep the screen on' : undefined}
            checked={keepAwake}
            onChange={setKeepAwake}
          />
          <Toggle
            label="Label every car"
            note="Off shows the leader, your driver and close battles"
            checked={allLabels}
            onChange={setAllLabels}
          />
        </section>

        <section className="card card-padded" aria-label="Track view">
          <label className="slider-row" htmlFor="elev">
            <span>Elevation</span>
            <span className="row-meta">{zx}× exaggerated</span>
          </label>
          <input
            id="elev"
            type="range"
            min={1}
            max={12}
            value={zx}
            onChange={(e) => setZx(Number(e.currentTarget.value))}
          />
          <p className="settings-help">
            Street circuits are almost flat, so the height of the track is stretched to make it
            readable when rotated.
          </p>
          <div className="layer-toggles">
            <Toggle label="Turn numbers" checked={showTurns} onChange={(v) => setLayer('showTurns', v)} flat />
            <Toggle
              label="Sector boundaries"
              checked={showSectors}
              onChange={(v) => setLayer('showSectors', v)}
              flat
            />
            <Toggle label="Pit lane" checked={showPitLane} onChange={(v) => setLayer('showPitLane', v)} flat />
          </div>
        </section>

        <button className="settings-replay" onClick={replayFromStart}>
          Replay this session from the start
        </button>

        <p className="settings-diag">
          {diagnostics(status, mode, stalled)}
          {fps != null && ` Drawing at ${fps} fps.`}
        </p>
      </div>
    </div>
  );
}

function Toggle({
  label,
  note,
  checked,
  onChange,
  flat = false,
}: {
  label: string;
  note?: string | undefined;
  checked: boolean;
  onChange: (v: boolean) => void;
  flat?: boolean;
}): React.JSX.Element {
  return (
    <label className={flat ? 'card-row is-flat' : 'card-row'}>
      <span className="row-main">
        <span>{label}</span>
        {note && <span className="row-note">{note}</span>}
      </span>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.currentTarget.checked)} />
    </label>
  );
}

/**
 * The data status line: how the stream is doing, in one sentence.
 *
 * "Behind real time" is only true of a live session. In a replay the newest
 * row is as old as the session is, so the same arithmetic reads "data 91560 s
 * behind" for a race that finished yesterday, which is a true number and a
 * useless sentence.
 */
export function diagnostics(
  status: { freshness: number | null; api: { auth: string; requests: number } } | null,
  mode: string,
  stalled = false,
  now = Date.now(),
): string {
  if (!status) return 'Waiting for the server.';
  const behind = status.freshness == null ? null : Math.max(0, Math.round((now - status.freshness) / 1000));
  const stream = stalled
    ? 'Stream interrupted, showing the last known positions'
    : mode === 'live'
      ? behind == null
        ? 'Live, waiting for the first data'
        : `Live stream healthy, data ${behind} s behind real time`
      : mode === 'replay'
        ? 'Replaying a finished session'
        : mode === 'locked'
          ? 'Live data locked on the free tier'
          : 'Waiting for a session';
  const access =
    status.api.auth === 'ok'
      ? 'OpenF1 sponsor access'
      : status.api.auth === 'rejected'
        ? 'OpenF1 credentials refused'
        : status.api.auth === 'pending'
          ? 'Signing in to OpenF1'
          : 'OpenF1 free tier';
  return `${stream}. ${access}, ${status.api.requests.toLocaleString('en-AU')} requests this session.`;
}
