// Mock OpenF1 for development when no session is on.
//
// Imitates the parts the feed depends on: the filter syntax, 404 for an empty
// result, the OAuth2 token endpoint, and a 401 inside the live window. Two
// sessions: a finished Sprint that is free to read, and a Race that is live from
// the moment this process starts.
//
// Run: npm run mock   then point the server at it with OPENF1_BASE.
// Ported from reference/prototype/mock/mock-openf1.js.

import http from 'node:http';
import { T0, type MockSession } from './circuit.js';
import { SESSIONS, iso, isLive } from './drivers.js';
import { circuitFile } from './circuit-file.js';
import { parseFilters, matches } from './filters.js';
import { rowsFor } from './rows.js';

const PORT = Number(process.env.MOCK_PORT) || 4001;
const TOKEN = 'mock-token';

/** The sessions endpoint, with the mock's internal fields stripped. */
function sessionRows(): Array<Record<string, unknown>> {
  return SESSIONS.map((s) => ({
    ...s,
    date_start: iso(s.start),
    date_end: iso(s.end),
    gmt_offset: '08:00:00',
    is_cancelled: false,
  })).map(({ start, end, laps, ...r }) => r);
}

http
  .createServer((req, res) => {
    const [pathname, qs = ''] = (req.url ?? '').split('?');
    const send = (code: number, body: unknown): void => {
      res.writeHead(code, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    };

    if (pathname === '/token' && req.method === 'POST') {
      return send(200, { access_token: TOKEN, expires_in: '3600', token_type: 'bearer' });
    }

    // The circuit detail file a meeting links to. Not an OpenF1 path, which is
    // the point: it stands in for the third-party host.
    if (pathname === '/circuit/9001') return send(200, circuitFile());

    const m = pathname?.match(/^\/v1\/([a-z_]+)$/);
    if (!m) return send(404, { detail: 'Not found' });
    const ep = m[1]!;
    const filters = parseFilters(qs);
    const authed = req.headers.authorization === `Bearer ${TOKEN}`;

    if (ep === 'meetings') {
      const rows = [
        {
          meeting_key: 9001,
          meeting_name: 'Harbourfront Grand Prix',
          circuit_key: 99,
          circuit_short_name: 'Harbourfront',
          country_name: 'Mockland',
          circuit_info_url: `http://localhost:${PORT}/circuit/9001`,
          gmt_offset: '08:00:00',
          year: new Date().getUTCFullYear(),
        },
      ].filter((r) => filters.every((f) => matches(r, f)));
      return rows.length ? send(200, rows) : send(404, { detail: 'No results found.' });
    }

    if (ep === 'sessions') {
      const out = sessionRows().filter((r) => filters.every((f) => matches(r, f)));
      // OpenF1 answers an empty result with 404, not an empty array.
      return out.length ? send(200, out) : send(404, { detail: 'No results found.' });
    }

    const sk = filters.find((f) => f[0] === 'session_key');
    const s: MockSession | undefined = SESSIONS.find((x) => sk && String(x.session_key) === sk[2]);
    if (!s) return send(404, { detail: 'No results found.' });
    // Inside the live window, unauthenticated requests are refused.
    if (isLive(s) && !authed) return send(401, { detail: 'Authentication required for live data' });

    let from = s.start - 60_000;
    let to = s.end + 60_000;
    for (const [k, op, raw] of filters) {
      if (k !== 'date') continue;
      if (op === '>' || op === '>=') from = Math.max(from, Date.parse(raw));
      if (op === '<' || op === '<=') to = Math.min(to, Date.parse(raw) + (op === '<=' ? 1 : 0));
    }

    const rows = rowsFor(ep, s, from, to).filter((r) => filters.every((f) => matches(r, f)));
    console.log(`${req.method} ${ep} ${rows.length} rows ${authed ? '(auth)' : ''}`);
    return rows.length ? send(200, rows) : send(404, { detail: 'No results found.' });
  })
  .listen(PORT, () => console.log(`mock OpenF1 on :${PORT}, lap time ${T0.toFixed(1)} s`));
