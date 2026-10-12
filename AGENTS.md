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

M5 done, with one check that cannot be run here. All seven flag states draw
their own band, and the safety car, red flag and finished layouts are built to
their artboards: the SC marker and yellow glow, the dimmed track and
suspension card, and the podium with the final classification. Protocol is v5.
Next is M6 in `docs/BUILD-PLAN.md`.

The acceptance check is in two halves, both automated. `npm test` walks the
mock replay and asserts the flag at each scripted moment; `npm run states`
drives the same replay in a browser and checks the band's colour, label and
height and the tower's columns for all eight states. A real bug came out of
M5's planning: `VSC DEPLOYED` was being read as a full safety car, so both of
Singapore 2026's virtual safety car periods were reported wrongly.

**Unverified:** "60 fps on the target iPhone", carried over from M2. There is
no device here, so it is measured in headless Chrome instead — a steady 60 fps
with a full field, which shows the scene is fast enough algorithmically but
says nothing about Safari on A-series hardware. Run it on a phone before
trusting it. This is the second check the project cannot close locally, after
MQTT against OpenF1's real broker.

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
no usable positions. Austin, the next race, is clean on its 2025 data — all 20
corners placed, worst 0.51% of span, pit lane derived. See `docs/OPENF1.md`
for what the failures look like and how a trace is judged.

`npm run layout` measures the rendered screen against the artboard,
`npm run scene` runs the scene checks, `npm run states` checks every race
state against its artboard and `npm run circuits` checks the pipeline against
real circuits; the first three fail on drift. Run them for any
change to the layout or the 3D view.

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
