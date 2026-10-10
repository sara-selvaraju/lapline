# Lapline build plan

Tracer bullets: each milestone ends with something that runs end to end on a phone, deploys to Railway, and is checked against the mock and, where possible, real OpenF1 data. Finish one before starting the next. Start each milestone in plan mode, agree the plan, then build.

**Definition of done for every milestone:**
- `npm run typecheck`, `npm test` and `npm run build` pass.
- The milestone's acceptance checks pass against `tools/mock-openf1`.
- Screenshots at 390 × 844 (and 844 × 390 where relevant) sit beside the matching artboards for comparison.
- `docs/ARCHITECTURE.md` is updated if a decision changed.

## M0. Skeleton and parity with the prototype

Port `reference/prototype/` into the workspace layout in TypeScript, keeping its behaviour, and deploy.

- npm workspaces: `apps/server`, `apps/web`, `packages/shared`, `tools/mock-openf1`.
- Server modules `openf1/`, `feed/` and `http/`, ported with their logic intact. The mock is ported too.
- Web: a Vite app that renders the prototype's view, with three.js bundled from npm.
- Scripts: `dev` (mock, server and web together), `build`, `start`, `test`, `typecheck`.
- One Railway service serving the built web app; `/healthz`; the lapline.live custom domain.

**Acceptance:**
- Replay of the mock Sprint and live mock Race both work, with the REST fallback in live.
- The free-tier server shows "locked" for the live mock Race.
- The deployed site loads on a phone at lapline.live.

## M1. Protocol v1 and the design shell

- `packages/shared/src/protocol.ts` with zod schemas, and a protocol version check on connect.
- Separate `tick` (4 Hz) and `timing` (1 Hz) events.
- Web store (Zustand) fed by the SSE client.
- Design tokens as CSS variables, and the font.
- Static layout for the main screen: flag band, header with live pill, track area placeholder, driver strip, tower and controls bar, filled from the store.

**Acceptance:**
- The portrait layout matches `Main.dc.html` within a few pixels (excluding the 3D view).
- About nine tower rows visible at 390 × 844.
- Protocol schema tests pass, including malformed rows.

## M2. The 3D scene

- `scene/` class: ribbon, glow, ground line, elevation posts and the exaggeration setting.
- Cars with interpolation, team colours, the selected ring and label, and stale styling.
- The label rule with screen-space collision avoidance.
- Camera presets Map, Tilt and Chase, plus manual orbit.
- Tap to select with a generous hit radius; bunch detection opens the car picker (`CarPicker.dc.html`).

**Acceptance:**
- 60 fps on the target iPhone with 22 mock cars.
- Selecting from the track and from the tower stays in sync.
- The picker opens when tapping a bunch of four mock cars.

## M3. Circuit detail

- Server `circuit/`: outline from the fastest lap, plus detail from `circuit_info_url` with a tolerant parser. Turns fall back to curvature detection when that file is missing.
- Pit lane derived from pit-stop traces.
- Scene layers: turn badges, sector boundaries, marshal ticks, start/finish line, direction chevron and pit lane, each switchable.
- Marshal-sector yellows from race control, drawn on the track.

**Acceptance:**
- Overlaying corner positions on a real Singapore lap trace shows them aligned. Use a finished 2026 Singapore session.
- The mock yellow at a marshal sector paints that section.
- No turn badge overlaps a car label or the camera group at the default view.

## M4. Driver strip, telemetry panel and tower rules

- Driver strip, and the expanded telemetry panel (`DriverDetail.dc.html`) with a 30 s speed trace and braking zones.
- Ahead and behind cycling.
- Tower: interval and gap toggle, battle chips, the lap-time colour rule, tyre rings and age, the pit badge.

**Acceptance:**
- Unit tests for the battle and lap-colour rules.
- Mock data shows purple on exactly one row, only on the lap just completed.

## M5. Race states

- Flag band variants: yellow, SC, SC ending, VSC, VSC ending, red, chequered.
- Safety car layout (`SafetyCar.dc.html`), red flag (`RedFlag.dc.html`) and finished (`Finished.dc.html`), including the SC car marker, the cars-in-pit-lane queue and the podium.

**Acceptance:**
- The mock's scripted race control events step through every state in replay, with the matching band and layout.

## M6. Replay and sync

- Replay transport, the speed cycle, ±10 s and the scrubber with SC, VSC and red flag markers (`Replay.dc.html`).
- Live controls; "Sync with TV" (`SyncSheet.dc.html`) using `GET /api/crossings` and the leader's lap start times.
- Delay remembered per session on the phone.

**Acceptance:**
- Seeking in replay refetches cleanly, with no stuck cars.
- In live mock, marking a crossing sets the delay to within ±1 s of the injected broadcast delay.

## M7. System states and settings

- Loading with staged progress (`Loading.dc.html`).
- Connection lost with last known positions and a retry (`Reconnecting.dc.html`).
- Locked, with a free-replay time and alternatives (`Locked.dc.html`).
- Settings sheet (`Settings.dc.html`).
- Password page and signed cookie in place of basic auth.

**Acceptance:**
- Killing the server shows the stale banner within 6 s, and the screen recovers on its own.
- The locked screen shows the correct local time for free replay.
- The password survives the iOS home-screen app relaunching.

## M8. Landscape and glance mode

- Landscape layout (`LiveLandscape.dc.html`) and glance mode (`Glance.dc.html`), including a way to enter it (see the open questions in `docs/DESIGN.md`).

**Acceptance:**
- Rotating mid-session keeps the selection, camera and stream without a reconnect.

## M9. Race-night hardening

- Verify MQTT against OpenF1's real broker during a practice session.
- Measure request rates, frame size and fps on a device, and record them in `docs/ARCHITECTURE.md`.
- Run the full race weekend as a soak test.

**Acceptance:** a full live session watched on a phone with no manual intervention.
