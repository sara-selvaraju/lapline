// The mock's field and its two sessions.
//
// A finished Sprint, free to read, and a Race that is live from the moment the
// mock starts — so the live-window lock can be exercised without a real session.
// Session times are relative to process start, so the server must be started
// after the mock, within the same run.

import { T0, type MockDriver, type MockSession } from './circuit.js';

/** Process start. Everything below is relative to it. */
export const NOW0 = Date.now();
const LAPS = 30;

export const DRIVERS: MockDriver[] = (
  [
    ['AVA', 'Ava ARDEN', 'Northline', 'E8702A'],
    ['BEN', 'Ben OKAFOR', 'Northline', 'E8702A'],
    ['CRU', 'Cruz VALE', 'Kestrel', '3671C6'],
    ['DEL', 'Dell MORROW', 'Kestrel', '3671C6'],
    ['EMI', 'Emi SATO', 'Ardent', 'E80020'],
    ['FIN', 'Finn HALE', 'Ardent', 'E80020'],
    ['GIO', 'Gio RAMOS', 'Verdant', '27F4D2'],
    ['HUX', 'Hux PALMER', 'Verdant', '27F4D2'],
    ['ISL', 'Isla REYES', 'Sable', '229971'],
    ['JUN', 'Jun TAKEDA', 'Sable', '229971'],
    ['KAI', 'Kai MBEKI', 'Lumen', 'FF87BC'],
    ['LEO', 'Leo FAURE', 'Lumen', 'FF87BC'],
    ['MAR', 'Mara COLE', 'Tidal', '64C4FF'],
    ['NOA', 'Noa BRANDT', 'Tidal', '64C4FF'],
    ['ORI', 'Ori LANG', 'Cinder', 'B6BABD'],
    ['PIP', 'Pip ADEYEMI', 'Cinder', 'B6BABD'],
    ['QUI', 'Quinn ROSS', 'Halcyon', '52E252'],
    ['RAF', 'Raf SILVA', 'Halcyon', '52E252'],
    ['SOL', 'Sol IVERS', 'Meridian', '6692FF'],
    ['TAM', 'Tam NGUYEN', 'Meridian', '6692FF'],
  ] as const
).map(([code, name, team, col], i) => ({
  n: i + 2,
  code,
  name,
  team,
  col,
  f: 1 + 0.0035 * i + 0.002 * Math.sin(i * 7.1),
}));

export const SESSIONS: MockSession[] = [
  { session_key: 1001, session_name: 'Sprint', session_type: 'Race', start: NOW0 - 26 * 3600_000, laps: 12 },
  { session_key: 1002, session_name: 'Race', session_type: 'Race', start: NOW0 - 3 * 60_000, laps: LAPS },
].map((s) => ({
  ...s,
  end: s.start + Math.max(45 * 60_000, s.laps * T0 * 1000 * 1.15),
  meeting_key: 9001,
  circuit_key: 99,
  circuit_short_name: 'Harbourfront',
  country_name: 'Mockland',
  location: 'Harbourfront',
  year: new Date().getUTCFullYear(),
}));

/** OpenF1 renders UTC as +00:00, not Z. The client has to cope with both. */
export const iso = (ms: number): string => new Date(ms).toISOString().replace('Z', '+00:00');

/** OpenF1's live window: 30 minutes either side of the session. */
export const isLive = (s: MockSession): boolean =>
  Date.now() >= s.start - 30 * 60_000 && Date.now() <= s.end + 30 * 60_000;
