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

M0 done: the prototype is ported to the workspace layout in TypeScript with its
behaviour unchanged, and deployed. Next is M1 in `docs/BUILD-PLAN.md`.

The deployed service is `lapline` on Railway. `lapline.live` is not registered
yet, so it runs at the generated Railway domain until that is bought and
pointed at the service.

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
