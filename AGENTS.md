# Lapline

A personal, non-commercial, phone-first second screen for F1 sessions: a 3D circuit with every car, a timing tower and telemetry for one selected car, live or as a replay. Data comes from OpenF1. The original runs at lapline.live.

## Read before working

- `docs/ARCHITECTURE.md`: structure, decisions, protocol. Follow it; propose changes rather than drifting.
- `docs/BUILD-PLAN.md` and `docs/HISTORY.md`: the milestones it was built in, all done, and what each one found.
- `docs/DESIGN.md`: tokens, layout, track drawing, interactions and states. The artboards in `design/artboards/` are the visual source of truth.
- `docs/OPENF1.md`: API behaviour, limits and quirks. Check it before calling OpenF1.
- `reference/prototype/`: the original prototype (plain JS), kept for history. Don't edit it.
- `design/sample-data.json`: payloads from the prototype's stream against the mock, so made-up data.

## Status

All ten milestones, M0 to M9, are done. The last acceptance check — a full
live race watched on a phone with no manual intervention — passed at Austin on
25 October 2026, at a steady 60 fps with a full field, Tilt view and all
three detail layers on. How each milestone went, and what it found, is in
`docs/HISTORY.md`.

Open:

- **The soak against the real feed** has not been run; the request rate, live
  frame size and reconnect count are still the mock's and a replay's. See
  "Surviving a long unattended run" in `docs/ARCHITECTURE.md`.
- **Unverified:** the home-screen half of M7's password check.
- **Flaky:** `npm run scene`'s "the picker offers four or more" check depends
  on the field happening to bunch where it sweeps, so it asserts a property of
  the data, not of the app. Rewrite it to assert that the picker offers every
  car actually under the tap.
- **The pit lane is empty against the mock,** correctly: the mock's cars never
  leave the racing line, so there is no lane to find, and the derivation fails
  closed rather than drawing one in the wrong place. Check pit lane changes
  against real data.

**Other circuits:** `npm run circuits` runs the shipped pipeline against real
sessions, a circuit at a time, and reports the outline, how well the circuit
file's corners land on it, the sectors and the pit lane. Run it for a circuit
new to the calendar before its first race weekend. Checked across eighteen
circuits on 12 October 2026: fourteen clean, Madrid and Kuala Lumpur on the
curvature fallback because they have no circuit file, Monaco and Hungary with
no usable positions. Austin was clean on its 2025 data — all 20
corners placed, worst 0.51% of span, pit lane derived. See `docs/OPENF1.md`
for what the failures look like and how a trace is judged.

## Checks

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

## Stack

Node 22, TypeScript strict, npm workspaces. Server: `apps/server`. Web: `apps/web` (Vite, React, three.js from npm, Zustand). Shared protocol: `packages/shared` (zod). Mock API: `tools/mock-openf1`. Tests: Vitest; Playwright for phone-size smoke tests.

## Commands

```
npm install
npm run dev          # mock OpenF1, server and web together
npm run typecheck
npm test
npm run build
npm start            # production server serving the built web app
```

Configuration is all environment variables, every one optional. The full list is under "Configuration" in `docs/ARCHITECTURE.md`.

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
