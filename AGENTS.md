# Lapline

A personal, non-commercial, phone-first second screen for F1 sessions: a 3D circuit with every car, a timing tower and telemetry for one selected car, live or as a replay. Data comes from OpenF1. Hosted on Railway at lapline.live.

## Read before working

- `docs/ARCHITECTURE.md`: structure, decisions, protocol. Follow it; propose changes rather than drifting.
- `docs/BUILD-PLAN.md`: milestones M0 to M9 with acceptance checks. Work one milestone at a time, in order.
- `docs/DESIGN.md`: tokens, layout, track drawing, interactions and states. The artboards in `design/artboards/` are the visual source of truth.
- `docs/OPENF1.md`: API behaviour, limits and quirks. Check it before calling OpenF1.
- `reference/prototype/`: the working prototype (plain JS). It proves the data path; port its logic, don't edit it.
- `design/sample-data.json`: real payloads from the prototype's stream.

## Status

M9 done. A full live session watched on a phone with no manual intervention —
the Austin race on 25 October 2026 — kept up with the broadcast from start to
finish, and nothing was seen to go wrong. The frame rate read off the settings
page during the race, with a full field, Tilt view and all three detail layers
on, was a steady 60 fps, which closes "60 fps on a recent iPhone", open since
M2. Railway showed resident memory flat at about 150 to 157 MB, in line with
the mock soak's peak.

**Not done at Austin:** the soak against the real feed. The request rate
against the sponsor budget, frame size on a live race and the reconnect count
over a real weekend are still the mock's and the Singapore replay's. Run it at
the next race:

```
npm run soak -- --url https://lapline.live --minutes 240 --out race.ndjson
```

and add the numbers to "Measured" in `docs/ARCHITECTURE.md`.

What M9 found and fixed is in six commits. On the server: a lock could not be
left, so a single 401 from a token refresh ended the session for good; pruning
ran below the idle guard, so a sleeping phone left MQTT filling buffers that
nothing trimmed; the fetch loop pushed a settled timer onto an array every
second; MQTT's first connection had no retry; and one listener throwing cost
every listener after it in the set that frame. On the client: every rebuild of
the track leaked 7 geometries and 10 textures, and `setCircuit` runs on each
nudge of the elevation slider, not just on a change of circuit. Six new server
tests and three new scene checks cover these, and most fail without their fix.
Dedupe keys were also capped at a flat 200,000, which was 45 minutes of keys
against buffers holding 90 seconds of rows; the cap now scales to what is
retained, and the clear gave back 10.7 MB of heap.

**The mock soak ran for 2.8 hours and is the baseline for the real feed.** One
listener held open throughout: no reconnects, no errors, 4.0 ticks a second
from start to finish, and a worst gap between ticks of 0.3 s against a 0.25 s
cadence. Resident memory rose 92.5 to 132.5 MB through the live session as it
filled with history and then went flat; the replay afterwards peaked at 152.5
and gave it back, ending at 102.6 with the final hour at -1.0 MB an hour. File
descriptors stayed between 24 and 26. **The live-to-replay handover survived**
— the transition that caused M1's 422 — with requests dropping from 46 a minute
to 4 and the stream never breaking stride.

Frame size, which M9 asks for and nothing had measured: against the deployed
site replaying Singapore with 22 cars, 7.7 kB/s all up — tick 1,090 B at 4 Hz,
timing 3,349 B at 1 Hz, hello 14,979 B once. A two-hour race is about 56 MB of
mobile data. All of it is in `docs/ARCHITECTURE.md` under "Measured".

MQTT against OpenF1's real broker, M9's first bullet, was already met during
the Singapore race on 11 October — see `docs/OPENF1.md`. The line that used to
say this project could not close that check locally was out of date and is
gone.

M8 done. Landscape is a reflow of the same tree rather than a second layout —
the track on the left at 470 px with the tower beside it — and glance mode
shows the top five in large type beside a flat map, entered from a button in
the landscape pill row and left by rotating back. Any window wider than tall
gets landscape, a laptop included. Next is M9 in `docs/BUILD-PLAN.md`.

The acceptance check is automated as `npm run rotate`: it rotates one live
page rather than loading two, and asserts the same `Scene` object survives,
the cars are not rebuilt, the selection and camera preset are kept, and no new
`EventSource` is ever opened. `npm run layout --landscape` measures the two
columns against `LiveLandscape.dc.html`.

Landscape was not merely plain before this — it was broken. The fixed regions
totalled 506 px against 390 of height with nothing allowed to shrink, so the
tower collapsed to nothing and the controls bar was clipped off the screen.

**Unverified:** the home-screen half of M7's password check. The frame rate,
also once unverified, was measured on a phone at Austin: 60 fps.

**Flaky, and not M3's doing:** `npm run scene`'s "the picker offers four or
more" check depends on the field happening to bunch where it sweeps. It passes
at some points of the Singapore race and finds no bunch at all at others, and
none in the mock. It asserts a property of the data, not of the app; M4 or
later should rewrite it to assert that the picker offers every car actually
under the tap.

The pit lane is empty against the mock, which is correct: the mock's cars never
leave the racing line, so there is no lane to find, and the derivation fails
closed rather than drawing one in the wrong place. It is verified against real
Singapore data instead.

**Other circuits:** `npm run circuits` runs the shipped pipeline against real
sessions, a circuit at a time, and reports the outline, how well the circuit
file's corners land on it, the sectors and the pit lane. Run it for a circuit
new to the calendar before its first race weekend. Checked across eighteen
circuits on 12 October 2026: fourteen clean, Madrid and Kuala Lumpur on the
curvature fallback because they have no circuit file, Monaco and Hungary with
no usable positions. Austin was clean on its 2025 data — all 20
corners placed, worst 0.51% of span, pit lane derived. See `docs/OPENF1.md`
for what the failures look like and how a trace is judged.

`npm run layout` measures the rendered screen against the artboard,
`npm run scene` runs the scene checks, `npm run states` checks every race
state against its artboard, `npm run stale` kills a server and watches the
screen recover, `npm run rotate` rotates a live page, `npm run circuits`
checks the pipeline against real circuits, and `npm run soak` watches a long
run from outside and reports the curve. Run the first five for any change to
the layout or the 3D view, and the soak for anything that touches how long the
server stays up.

They all point at `http://localhost:3000`, which is where `npm run dev` puts
the server; pass `--url` for anywhere else. `npm run stale` is the exception —
it starts and kills its own server, because that is the thing it is testing.

Live at https://lapline.live, behind the password. `www.lapline.live` serves the
same app. DNS is Cloudflare, registration GoDaddy, hosting Railway.

Worth knowing before changing DNS: Cloudflare flattens the apex CNAME into an A
record, which Railway's custom-domain check cannot verify, so `lapline.live` is
**proxied** through Cloudflare and reaches Railway by Host header. It therefore
needs to stay listed as a custom domain on the Railway service even though
Railway shows it unverified. `www` is a true CNAME, DNS only, and goes straight
to Railway. Server-sent events were measured at a steady 4 Hz through both.

## Stack

Node 22, TypeScript strict, npm workspaces. Server: `apps/server`. Web: `apps/web` (Vite, React, three.js from npm, Zustand). Shared protocol: `packages/shared` (zod). Mock API: `tools/mock-openf1`. Tests: Vitest; Playwright for phone-size smoke tests.

## Commands (once M0 lands)

```
npm install
npm run dev          # mock OpenF1, server and web together
npm run typecheck
npm test
npm run build
npm start            # production server serving the built web app
```

Useful environment variables, all optional in development:

| Variable | Purpose |
|---|---|
| `OPENF1_BASE` | Point at the mock, for example `http://localhost:4001` |
| `OPENF1_USERNAME`, `OPENF1_PASSWORD` | Sponsor credentials for live data |
| `OPENF1_MIN_GAP_MS` | Override request spacing in tests |
| `LIVE_TRANSPORT` | `mqtt` (default) or `rest` |
| `LIVE_DELAY_S` | Starting live delay, default 10 |
| `SESSION_KEY` | Pin a session; default `auto` |
| `APP_PASSWORD`, `SESSION_SECRET` | Access control |

## Rules

- **Never call OpenF1 from the browser.** Credentials and the rate-limit budget live on the server.
- **All OpenF1 requests go through the single request queue** in `apps/server/src/openf1/`. Don't add a second client.
- **Treat an OpenF1 404 as no rows.** Treat 401 inside the live window as locked, not as an error.
- **Validate at the edges:** upstream rows through zod schemas (tolerant: drop bad rows, don't crash), and protocol messages on both sides.
- **Keep the scene imperative.** `apps/web/src/scene/` is plain three.js driven by the store. Don't push per-frame data through React state.
- **Shared types only from `packages/shared`.** Never duplicate a protocol type in an app.
- **Derived values are pure functions** in `apps/server/src/derive/`, with unit tests.
- **Render upstream text as text,** never as HTML.
- **Never commit or log secrets.** Don't echo env values in `/api/state` or errors.
- **Match the design exactly.** Use the tokens, not new colours or sizes. If the design is missing a state, build the closest one, note it under "Open design questions" in `docs/DESIGN.md`, and say so.
- **No F1, Formula 1 or team logos, and no driver photos.** Keep "F1" out of the product name and UI chrome.
- **Australian English** in UI copy and docs. Sentence case.
- **Small, reviewable changes.** One concern per commit, with a message that says why.

## Verifying work

- Run the mock for every change touching data flow: replay the mock Sprint, and run the mock Race live with `LIVE_TRANSPORT=rest` and fake credentials.
- For UI changes, capture screenshots at 390 × 844 and compare them with the matching artboard before calling the work done.
- When a check can't be run (for example, real MQTT outside a session), say so explicitly rather than assuming it works.
