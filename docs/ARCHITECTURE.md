# Lapline architecture

Lapline is a personal, non-commercial, phone-first second screen for Formula 1 sessions. It shows a 3D circuit with every car, a timing tower, and telemetry for one selected car, live or as a replay. Data comes from OpenF1 (see `docs/OPENF1.md`).

This document records the target architecture and the decisions behind it. The working prototype in `reference/prototype/` already proves the data path end to end against a mock; the job is to rebuild it on this structure and to the design in `docs/DESIGN.md`, not to start from zero.

## Shape of the system

```
                 OpenF1 (REST, MQTT over WSS)
                              │
                 ┌────────────▼────────────┐
                 │  apps/server (Node 22)  │
                 │                         │
                 │  openf1/   client, token, request queue
                 │  feed/     session, clock, buffers, scheduler
                 │  derive/   flags, tyres, battles, crossings
                 │  circuit/  outline, turns, sectors, pit lane
                 │  http/     SSE stream, controls, auth, static
                 └────────────┬────────────┘
                              │  SSE (protocol v1, packages/shared)
                 ┌────────────▼────────────┐
                 │  apps/web (Vite, React) │
                 │                         │
                 │  store/    frame store, prefs
                 │  scene/    three.js, imperative, own render loop
                 │  ui/       screens and components from the design
                 └─────────────────────────┘
```

One Railway service runs the server, which also serves the built web app. Every connected phone shares one upstream feed, so the OpenF1 rate limit is spent once no matter how many viewers there are.

## Repository layout

```
apps/server/        Node service (TypeScript)
apps/web/           Phone UI (Vite, React, TypeScript, three.js from npm)
packages/shared/    Protocol types and zod schemas used by both apps
tools/mock-openf1/  Development stand-in for OpenF1 (port of the prototype mock)
docs/               This file, OpenF1 notes, design spec, build plan
design/             Design canvas sources, sample payloads, screen exports
reference/prototype/ The working prototype, kept read-only for reference
```

npm workspaces, TypeScript strict mode throughout, Node 22.

## Decisions

| Decision | Choice | Why |
|---|---|---|
| Server to phone transport | Server-Sent Events | One-way stream is all that's needed; browsers reconnect on their own; passes cleanly through Railway's proxy. Controls go over plain `POST` |
| Upstream live data | OpenF1 MQTT over WSS, REST polling as automatic fallback | MQTT is OpenF1's recommended live path; the fallback has been tested and fits the sponsor rate limit |
| Shared contract | `packages/shared` with zod schemas and a protocol version | Server and web can't drift; malformed upstream rows are caught at the edge |
| UI framework | React for screens, three.js driven imperatively | Screens are state-heavy and suit components; the 3D scene updates at display rate and must not re-render through React |
| Client state | One small store (Zustand) fed by the SSE stream | Components subscribe to slices; the scene reads the store directly each frame |
| 3D library | `three` from npm, not a CDN | The prototype's CDN dependency failed in one environment; bundling removes it |
| Access control | Password page that sets a signed, HttpOnly cookie | Basic auth prompts are unreliable in iOS home-screen web apps. Keep `/healthz` open |
| Hosting | One Railway service, custom domain `lapline.live` | Simplest thing that works; no database needed |
| DNS | Cloudflare, registration left at GoDaddy | GoDaddy cannot put a CNAME on the apex and offers no ALIAS or flattening, so `lapline.live` itself could not reach Railway. Cloudflare flattens it. The apex is proxied and routes to Railway by Host header; `www` is DNS only and goes direct |
| Persistence | None server-side; per-phone preferences in `localStorage` | Replays come from OpenF1's free historical data, so nothing needs storing |

Revisit a decision only with evidence, and record the change here.

## Server

### openf1/

- One request queue for the whole process. Spacing is 2.1 s between request starts on the free tier and 1.1 s with sponsor credentials, overridable by `OPENF1_MIN_GAP_MS` for tests.
- OAuth2 password flow with the token refreshed a minute before its one-hour expiry; one retry on 401 with a fresh token.
- 404 means "no rows", not an error. 429 backs off and retries.
- A typed `LockedError` when the live window needs credentials that aren't configured.
- MQTT client recreated every 50 minutes and after any disconnect, so each connection uses a fresh token.

### feed/

- Holds exactly one session at a time. Selecting a session bumps a generation number, so stale async work is discarded.
- **Modes:** `live` (inside OpenF1's live window, credentials present), `replay` (any finished session, or "replay from start"), `locked` (live window, no credentials) and `idle`.
- **Clock:** live time is the current time minus a delay the viewer adjusts (default 10 s, range 4 to 180 s). In replay, the clock is anchored and runs at 1×, 2×, 4×, 8× or 16×, with seek.
- **Buffers per car:** location and car data, sorted, deduplicated by driver and timestamp, and pruned to about 90 s behind the clock.
- **Replay fetching:** timing data loads once per session; location and car data load in windows just ahead of the clock. The window size scales with playback speed.
- **Live fetching:** MQTT carries the stream. If MQTT is quiet for 20 s, REST polling takes over using overlapping windows, with location and car data every 4 s and timing every 15 s. That uses about 42 of the 60 requests a minute.
- Fetching pauses when no viewer has been connected for 60 s.

### derive/

Pure functions with unit tests. Inputs are buffers and a time; outputs are values for the protocol.

- Interpolated car positions at time `t`; a car is stale if its newest sample is more than 8 s old.
- Track flag state from race control: green, yellow, SC, SC ending, VSC, VSC ending, red, chequered.
- Marshal-sector flags from race control messages that carry a `sector`.
- Current lap, last lap, best lap, and whether the last lap was a personal or overall best set on the lap just completed.
- Tyre compound and age from stints.
- Pit lane status from pit records.
- Battles: consecutive cars within 1.0 s, only under green.
- Leader line crossings: the start times of the leader's laps, used by "Sync with TV".

### circuit/

Builds everything the track drawing needs, once per session, and caches it per meeting.

- **Outline:** the position trace of the fastest clean lap. During a live session with no completed laps yet, the outline comes from an earlier session of the same meeting. Light smoothing is applied to z.
- **Detail:** turn numbers and positions, marshal sectors, sector boundaries and orientation come from the meeting's `circuit_info_url` (see `docs/OPENF1.md` for the caveats). When that's unavailable, turns are derived from curvature peaks on the outline, the method used for the design mock-ups.
- **Pit lane:** derived from the position traces of cars between pit entry and exit.
- **Transform:** centre, scale to 100 world units across, and rotation, sent once with the outline. Positions stay in OpenF1's raw coordinates on the wire.

### http/

- `GET /events`: the SSE stream (protocol below). Sends a heartbeat every 15 s, with `X-Accel-Buffering: no`.
- `POST /api/control`: select session, play or pause, speed, seek, live delay, follow-live-sessions.
- `GET /api/crossings?since=`: the leader's recent line-crossing times, for the sync flow, with the lap's length in metres and where the leader is in it.
- `GET /api/periods`: the stretches the track was not green, for the replay scrubber's markings. A query rather than a protocol field: it is asked for once, by one screen, and the scrubber only exists in replay.
- `GET /api/state`: a debug snapshot. `GET /healthz`: liveness, outside the password. Nothing in either echoes an environment value.
- Auth: `GET /login` serves a self-contained page and `POST /login` sets a signed cookie, or the site is open when `APP_PASSWORD` is unset. A page request without one is redirected to the form; a fetch gets a plain 401, so a stale tab cannot feed HTML to a JSON parser.
- Static: the built web app, with long cache headers for hashed assets.

## Protocol v2 (SSE)

All types live in `packages/shared/src/protocol.ts`, as zod schemas. Both sides
validate: the client checks every inbound message and drops malformed frames
rather than letting them reach the store, and the tests validate what the server
sends, since validating at 4 Hz in the hot path is work for no benefit when the
schema is what produced the data.

Clients check `protocolVersion` on `hello` and reload on mismatch, once — a
server stuck on the wrong version must not loop the page.

**Version history.** v1 split `timing` out of `tick` and renamed `init` to
`hello` and `track` to `circuit`. v2 replaced `ApiStats.authed` with
`ApiStats.auth`, because a boolean could only say whether credentials were
configured, so a rejected credential reported as authenticated and the UI
promised live data it could not deliver.

| Event | Rate | Carries |
|---|---|---|
| `hello` | on connect and on session change | protocol version, session, mode, drivers, session list, circuit (outline, transform, turns, sectors, marshal sectors and the pit lane), status, whether live is possible |
| `tick` | 4 per second | session time; per car a compact tuple of number, x, y, z, speed, gear, RPM, throttle, brake and stale; replay or live meta |
| `timing` | 1 per second | tower rows; leader lap and total laps; track flag; marshal-sector flags; last four race control messages; battles |
| `status` | on change | level, text, mode, freshness (time of the newest upstream row), auth state, request count |
| `circuit` | when the outline improves | same circuit block as in `hello` |

`timing` also carries `flagSince` and `flagSinceLap`, which say when the standing flag began and on which lap, and each tower row carries a `stops` count. The final classification comes from OpenF1's `session_result`, fetched once when the chequered flag falls and sent on `hello` rather than on every timing frame. `timing` carries `battles` and `marshalSectors`, both filled since M4 and M3, and `totalLaps`, which stays null because OpenF1 publishes no total-lap figure. Each tower row also carries `lapFlag`, the lap colour decided server-side: the rule is about the lap just completed, which the client cannot see from a row's values alone.

The prototype sent timing inside every fourth tick; v1 split it out. A positions tick is about 1 KB and a timing frame about 2 KB, so a two-hour race costs about 45 MB of mobile data.

## Web

The live delay is one value on the feed, shared by everyone connected, and each phone remembers its own per session and re-asserts it on opening that session. With two phones watching the same session, whoever syncs last moves both views. That is the cost of a single shared clock, and it is the right trade while the design is for one viewer.

- **store/:** a single store, fed only by the SSE client. It holds the latest frame plus the previous one per car for interpolation, the timing state, status, circuit and preferences. Preferences (selected driver, gap mode, elevation scale, labels, camera preset and per-session sync delay) persist to `localStorage`, with every access wrapped in try/catch.
- **scene/:** a class with `setCircuit()`, `setFrame()`, `setSelection()`, `setCamera(preset)` and `dispose()`. It owns its render loop and reads the store directly. It handles car labels with screen-space collision avoidance, picking with a generous hit radius, and tap-on-a-bunch detection that opens the car picker. Camera presets are Map (top-down), Tilt (default) and Chase (low and behind the selected car). Manual orbit, pinch and pan still work.
- **ui/:** one component per design area: flag band, header, track overlays, driver strip, telemetry panel, timing tower, controls bar, sheets (sync, settings, car picker) and state screens. Names follow `docs/DESIGN.md`.
- Wake lock while visible. Reconnect when the page returns to the foreground. Safe-area insets. PWA manifest.

## Measured

Numbers taken during M0 unless a row says otherwise, against
`tools/mock-openf1` and against real OpenF1 data. The M9 rows come from
`npm run soak`, which samples the process from outside — `/proc` for memory
and descriptors, `/api/state` for the feed, one held-open SSE connection for
the frames — so nothing in the running code changes to be measured.

| Measurement | Value | How |
|---|---|---|
| Live REST request rate | 44.5/min | Sponsor credentials, `LIVE_TRANSPORT=rest`, mock Race, 120 s window. Agrees with 44.0/min counted independently in the mock's own log |
| Live REST plan, demanded | 48/min | Arithmetic over the plan; queue spacing and the 1 s scheduler tick stretch it to the measured figure |
| Free-tier replay rate | 6/min at 1x, 12/min at 8x | Mock Sprint |
| Opening a real session | 17 requests, about 40 s | Singapore qualifying on the free tier, 2.1 s spacing |
| `intervals` for one race | 3,044,250 bytes, 4.1 s | Real session 11731. `laps` is 527,507 bytes, `race_control` 79,757 |
| Frame rate out | 4.0 ticks/s, 1.0 timing/s | Measured through the Vite dev proxy and direct |
| Built web bundle | 502 KB, 129 KB gzipped at M0; 597 KB, 156 KB with React | Vite, three.js included |
| Self-hosted font | 91 KB, four weights | Barlow Semi Condensed, latin subset, SIL OFL |
| Portrait layout | every region exact against `Main.dc.html` | Measured by `npm run layout`, not eyeballed |
| Frame size, `tick` | 886 B at 4 Hz = 3.5 kB/s | M9, `npm run soak`, mock Race live over REST, 20 cars |
| Frame size, `timing` | 3,105 B at 1 Hz = 3.1 kB/s | Same run. The tower is the expensive half of the stream |
| Frame size, `hello` | 7,882 B once | Includes the circuit outline and the driver list |
| Frame size, `ping` | 39 B every 15 s | Keeps the connection from being reaped |
| **The whole stream** | **6.7 kB/s, 24 MB an hour** | Same run. A two-hour race is about 48 MB of mobile data. A real field is 22 cars, so read this as a floor |
| Worst gap between ticks | 0.3 s | Same run, against a 0.25 s cadence |
| Scene rebuild | 0 geometries, 0 textures leaked | M9, `npm run scene`. Was 7 and 10 per rebuild, and `setCircuit` runs on every nudge of the elevation slider |

The `intervals` figure is the one to watch: a real race replay moves about
3.7 MB over its eight session-open requests, which puts 25 to 30 seconds between
opening a session and the tower filling. That is a `feed/` problem, not a UI one,
and it sits against the first-useful-paint target below.

## Surviving a long unattended run

M9's acceptance is a full live session watched on a phone with nobody there to
work around anything, so these are deliberate choices rather than accidents of
the code.

- **A lock is a wait, not an ending.** A 401 inside the live window means
  locked, but the cause may be a token endpoint having a bad minute rather than
  a lapsed sponsorship. `feed/` records what it was doing, retries from 30 s
  out to 5 minutes, and only a lock with no credentials behind it stays put.
  Equally, `tokenRejected` latches only on a 4xx: a 503 is OpenF1 having a
  moment, not an answer about the credential.
- **Pruning runs even when fetching does not.** Nobody connected pauses the
  fetch plan, but MQTT keeps pushing rows in, so `prune` sits above the idle
  guard.
- **One listener cannot take the stream down.** Each SSE write stands alone and
  a failing listener is dropped, and the response carries an `error` handler,
  because an unhandled `error` on a stream ends the process.
- **An unhandled rejection is logged, not fatal; an uncaught exception exits.**
  A stray rejection is no reason to drop everyone's stream. A corrupt state is,
  and `railway.json` restarts ON_FAILURE with ten retries, so a clean process
  is back in about twenty seconds. Only the message is logged, never the error's
  own fields, which can carry a URL.
- **The scene gives back what it rebuilds.** `setCircuit` runs on every nudge of
  the elevation slider, so clearing a group disposes what it held.
- **Dedupe keys are held for the rows that are kept.** Four per retained row,
  with a floor of 5,000, rather than a flat 200,000 — which at a live race's
  4,400 keys a minute was 45 minutes of keys against 90 seconds of rows.
- **`pos`, `ivl`, `laps`, `rc` and `pits` are kept for the session, on purpose.**
  `lapColour` scans the whole lap history, `flagPeriods` the whole race control
  feed, and `crossings` the leader's positions, so these are not caches to
  trim. Measured against the mock race: `pos` and `ivl` grow about 300 rows a
  minute each and a session's worth is a few MB. `loc` and `car` are the ones
  that would not fit, and those are pruned to 90 seconds behind the clock.

`npm run soak` is the instrument for all of this: run it for hours and read the
curve, not the snapshot. A leak is a slope.

## Non-functional targets

- 60 fps on a recent iPhone in the Tilt view with 22 cars and all circuit detail on; no worse than 30 fps on a three-year-old Android.
- First useful paint under 2 s on 4G for a cached session.
- A visible freshness signal within 6 s of the stream stalling.
- Under 50 requests a minute to OpenF1 in live REST fallback; under 30 a minute on the free tier in replay.

## Security

- OpenF1 credentials and `APP_PASSWORD` exist only as Railway variables. Never in the client bundle, logs or `/api/state`.
- Untrusted upstream data (race control text, driver names) is rendered as text, never as HTML.
- The cookie is signed with `SESSION_SECRET`, HttpOnly, Secure and SameSite=Lax.

## Out of scope for now

- 3D buildings and terrain around the circuit, for example Google Photorealistic 3D Tiles or OpenStreetMap buildings. Leave a seam in `scene/` for a background layer.
- Accounts, multi-user state, and anything commercial. OpenF1's terms are personal and non-commercial.
