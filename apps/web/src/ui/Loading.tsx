// Opening a session, with the stages named.
//
// Built to design/artboards/Loading.dc.html. The stages are read off what the
// store already holds rather than reported by the server: each one is a
// question the client can answer for itself, so the wire stays as it is.
//
// The honest reason this screen exists at all is in its own footnote — free
// OpenF1 access spaces requests out, so opening a replay takes about twenty
// seconds and silence for that long looks broken.

import { useStore } from '../store/store.js';

export interface Stage {
  label: string;
  done: boolean;
}

/** The five stages, in the order they complete. */
export function stages(s: {
  drivers: number;
  laps: boolean;
  outline: number;
  order: number;
  cars: number;
}): Stage[] {
  return [
    { label: 'Session and drivers', done: s.drivers > 0 },
    { label: 'Laps, tyres and pit stops', done: s.laps },
    { label: 'Track outline from the fastest lap', done: s.outline > 50 },
    { label: 'Race order and gaps', done: s.order > 0 },
    { label: 'Car positions and telemetry', done: s.cars > 0 },
  ];
}

export function Loading(): React.JSX.Element {
  const session = useStore((st) => st.session);
  const drivers = useStore((st) => st.drivers.size);
  const rows = useStore((st) => st.timing?.rows);
  const outline = useStore((st) => st.circuit?.points.length ?? 0);
  const cars = useStore((st) => st.tick?.cars.length ?? 0);

  const list = stages({
    drivers,
    // A row carrying a tyre means the stints and laps have landed.
    laps: Boolean(rows?.some((r) => r.tyre != null || r.last != null)),
    outline,
    order: rows?.length ?? 0,
    cars,
  });
  const at = list.findIndex((s) => !s.done);

  return (
    <section className="loading" aria-label="Loading progress">
      <h2>{session ? `Getting the ${session.name.toLowerCase()} ready` : 'Getting the session ready'}</h2>
      <ol className="stages">
        {list.map((s, i) => (
          <li key={s.label} className={s.done ? 'is-done' : i === at ? 'is-now' : 'is-next'}>
            <span className="stage-mark" aria-hidden="true">
              {s.done ? '✓' : ''}
            </span>
            <span className="stage-label">{s.label}</span>
            <span className="stage-state">{s.done ? 'Done' : i === at ? 'Loading' : ''}</span>
          </li>
        ))}
      </ol>
      <p className="loading-note">
        Free OpenF1 access spaces requests out, so a replay takes about 20 seconds to open. Cars
        appear as soon as the first positions arrive.
      </p>
    </section>
  );
}
