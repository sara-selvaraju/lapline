// Row generation per endpoint.
//
// Rows are computed on demand from the circuit model rather than stored, so a
// window request returns exactly what a real session would have published in it.
// Ported from reference/prototype/mock/mock-openf1.js.

import { N, progress, pitLap, lapWobble, v, where, T0, type MockSession } from './circuit.js';
import { DRIVERS, iso } from './drivers.js';

type Row = Record<string, unknown>;

export function rowsFor(ep: string, s: MockSession, from: number, to: number): Row[] {
  const out: Row[] = [];
  // Live data lags real time by about 2 s, as OpenF1's does.
  const lim = Math.min(to, s.end, Date.now() - 2000);
  const base = { meeting_key: s.meeting_key, session_key: s.session_key };

  // Reproduces a session that upstream has no positions for. Monaco 2026 is
  // like this: every session of the meeting 404s on location while laps,
  // timing and telemetry are all present. Opt-in, so the mock's default
  // output stays exactly what the prototype's did.
  if (ep === 'location' && process.env.MOCK_NO_LOCATION === '1') return [];

  if (ep === 'location' || ep === 'car_data') {
    const step = 270;
    const j0 = Math.max(0, Math.ceil((from - s.start) / step));
    for (let j = j0; s.start + j * step < lim; j++) {
      for (const d of DRIVERS) {
        // Cars are sampled a few ms apart, as real telemetry is.
        const t = s.start + j * step + d.n * 7;
        if (t < from || t >= lim) continue;
        const p = progress(s, d, t);
        const w = where(p);
        if (ep === 'location') {
          out.push({
            ...base,
            date: iso(t),
            driver_number: d.n,
            x: Math.round(w.x),
            y: Math.round(w.y),
            z: Math.round(w.z),
          });
        } else {
          const moving = p > 0 && p < s.laps;
          const kmh = moving ? Math.round((v[w.i]! / d.f) * 3.6) : 0;
          const dv = v[(w.i + 6) % N]! - v[w.i]!;
          const brake = moving && dv < -1.5 ? 100 : 0;
          const thr = !moving ? 0 : brake ? 0 : Math.max(20, Math.min(100, Math.round(70 + dv * 15)));
          out.push({
            ...base,
            date: iso(t),
            driver_number: d.n,
            speed: kmh,
            n_gear: moving ? Math.max(1, Math.min(8, Math.round(kmh / 42) + 1)) : 0,
            rpm: moving ? Math.round(8200 + ((kmh % 42) / 42) * 3300) : 4000,
            throttle: thr,
            brake,
            drs: 0,
          });
        }
      }
    }
    return out;
  }

  if (ep === 'position' || ep === 'intervals') {
    const step = 4000;
    const j0 = Math.max(0, Math.ceil((from - s.start) / step));
    for (let j = j0; s.start + j * step < lim; j++) {
      const t = s.start + j * step;
      if (t < from) continue;
      const pr = DRIVERS.map((d) => ({ d, p: progress(s, d, t) })).sort((a, b) => b.p - a.p || a.d.n - b.d.n);
      pr.forEach((e, idx) => {
        if (ep === 'position') {
          out.push({ ...base, date: iso(t + 5), driver_number: e.d.n, position: idx + 1 });
        } else {
          const lead = pr[0]!.p;
          const ahead = idx ? pr[idx - 1]!.p : null;
          const gapL = (lead - e.p) * T0 * e.d.f;
          const gapA = ahead == null ? null : (ahead - e.p) * T0 * e.d.f;
          out.push({
            ...base,
            date: iso(t + 10),
            driver_number: e.d.n,
            gap_to_leader: idx === 0 ? null : lead - e.p >= 1 ? '+1 LAP' : +gapL.toFixed(3),
            interval: idx === 0 ? null : +gapA!.toFixed(3),
          });
        }
      });
    }
    return out;
  }

  if (ep === 'laps') {
    for (const d of DRIVERS) {
      for (let lap = 1; lap <= s.laps; lap++) {
        const st = s.start + ((d.n - 2) * 0.3 + (lap - 1) * T0 * d.f) * 1000;
        if (st > lim) break;
        const dur = T0 * d.f + lapWobble(d.n, lap);
        const done = st + dur * 1000 <= lim;
        out.push({
          ...base,
          driver_number: d.n,
          lap_number: lap,
          date_start: iso(st),
          // The opening lap carries the standing start.
          lap_duration: done ? +(dur + (lap === 1 ? 4 : 0)).toFixed(3) : null,
          is_pit_out_lap: lap === pitLap(d) + 1,
        });
      }
    }
    return out;
  }

  if (ep === 'stints') {
    for (const d of DRIVERS) {
      out.push({
        ...base,
        driver_number: d.n,
        stint_number: 1,
        compound: d.n % 3 ? 'MEDIUM' : 'SOFT',
        lap_start: 1,
        lap_end: pitLap(d),
        tyre_age_at_start: d.n % 3 ? 0 : 3,
      });
      out.push({
        ...base,
        driver_number: d.n,
        stint_number: 2,
        compound: 'HARD',
        lap_start: pitLap(d) + 1,
        lap_end: null,
        tyre_age_at_start: 0,
      });
    }
    return out;
  }

  if (ep === 'pit') {
    for (const d of DRIVERS) {
      const t = s.start + ((d.n - 2) * 0.3 + pitLap(d) * T0 * d.f) * 1000 - 8000;
      if (t <= lim) {
        out.push({
          ...base,
          driver_number: d.n,
          date: iso(t),
          lap_number: pitLap(d),
          lane_duration: 21.8,
          pit_duration: 21.8,
          stop_duration: 2.3,
        });
      }
    }
    return out;
  }

  if (ep === 'race_control') {
    // Scripted so replay steps through yellow, safety car and chequered.
    // Sector-scoped rows carry their marshal sector, as the real feed does:
    // Singapore's race sent 18 of them. Without the number nothing downstream
    // can tell which part of the track to paint.
    const ev: Array<[number, string, string | null, string, string, number | null]> = [
      [0, 'Flag', 'GREEN', 'Track', 'GREEN LIGHT - PIT EXIT OPEN', null],
      [5 * 60_000, 'Flag', 'YELLOW', 'Sector', 'YELLOW IN TRACK SECTOR 7', 7],
      [6 * 60_000, 'Flag', 'CLEAR', 'Sector', 'CLEAR IN TRACK SECTOR 7', 7],
      [9 * 60_000, 'SafetyCar', null, 'Track', 'SAFETY CAR DEPLOYED', null],
      [11 * 60_000, 'SafetyCar', null, 'Track', 'SAFETY CAR IN THIS LAP', null],
      [12 * 60_000, 'Flag', 'GREEN', 'Track', 'TRACK CLEAR', null],
      [s.laps * T0 * 1000, 'Flag', 'CHEQUERED', 'Track', 'CHEQUERED FLAG', null],
    ];
    for (const [dt, category, flag, scope, message, sector] of ev) {
      const t = s.start + dt;
      if (t <= lim) {
        out.push({
          ...base,
          date: iso(t),
          category,
          flag,
          scope,
          message,
          driver_number: null,
          lap_number: null,
          sector,
        });
      }
    }
    return out;
  }

  if (ep === 'drivers') {
    return DRIVERS.map((d) => ({
      ...base,
      driver_number: d.n,
      name_acronym: d.code,
      full_name: d.name,
      broadcast_name: d.name.toUpperCase(),
      team_name: d.team,
      team_colour: d.col,
    }));
  }

  return out;
}
