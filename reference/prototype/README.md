> **Historical.** This is the plain-JS prototype Lapline started from, kept
> read-only for reference. It has been replaced by the app in `apps/` and is
> not maintained: its access control (Basic auth), prices and instructions are
> as they were then. Start from the README at the root of the repo.

# Lapline

A personal, phone-first F1 viewer. It shows the circuit in 3D (drag to rotate, pinch to zoom), every car in its team colour, a timing tower, and telemetry for the selected car. Data comes from [OpenF1](https://openf1.org).

Non-commercial use only, in line with OpenF1's terms. OpenF1 is unofficial and not affiliated with Formula 1.

## How it works

One Node process talks to OpenF1 and streams frames to any open browser over Server-Sent Events. Browsers never call OpenF1 directly, so:

- the OpenF1 credentials stay on the server;
- several phones share one upstream connection and one rate-limit budget.

The server picks a mode for the selected session:

| Mode | When | Data path |
|---|---|---|
| Live | The session is inside OpenF1's live window (30 min before start until 30 min after end) and sponsor credentials are set | MQTT over WebSocket. REST polling takes over whenever MQTT has been quiet for 20 s |
| Replay | The session has finished, or "Replay from start" was pressed | REST: timing data loads once, positions and telemetry load in windows just ahead of the clock |
| Locked | Live window, no credentials | Nothing; the screen says when the session becomes free to replay |

The track outline comes from the fastest clean lap's position trace. When a live session has no completed laps yet, the outline comes from an earlier session at the same weekend. Elevation is OpenF1's z value, lightly smoothed and exaggerated (adjustable in settings, 4× by default) because street circuits are nearly flat.

Frames go out at 4 per second for positions and telemetry and once per second for timing, which is about 4 KB/s per phone.

## Deploy on Railway

1. Push this folder to a GitHub repository, then create a Railway project from it. Railway detects Node and runs `npm start`.
2. Under the service's Variables, set what applies:

| Variable | Needed for | Notes |
|---|---|---|
| `OPENF1_USERNAME`, `OPENF1_PASSWORD` | Live data | Sponsor account credentials (€9.90/month). Leave unset for free replay only |
| `APP_PASSWORD` | Recommended | Puts the whole site behind a browser password prompt (any username). Without it, anyone with the URL can use the shared OpenF1 budget |
| `LIVE_DELAY_S` | Optional | Starting delay behind real time in live mode, default 10. Adjustable on screen |
| `SESSION_KEY` | Optional | Pin a session at start-up. Default `auto` follows whichever session is live, otherwise the latest one |
| `LIVE_TRANSPORT` | Optional | `mqtt` (default) or `rest` |

3. Under Settings, generate a public domain. Set the health check path to `/healthz` if you want one; it is the only route outside the password.
4. On the phone, open the URL and use "Add to Home Screen" for a full-screen app.

### Custom domain: lapline.live

1. In the Railway service's settings, add `lapline.live` as a custom domain. Railway shows the DNS record it expects.
2. At the registrar, create that record. Many registrars don't allow a CNAME on the bare domain, so either use their ALIAS or flattening option, or put the app on `www.lapline.live` and redirect the bare domain to it.
3. Wait for Railway to show the domain as active. It issues the TLS certificate itself, usually within a few minutes of DNS resolving.
4. Keep `APP_PASSWORD` set. A memorable domain is easy to find, and the password protects the shared OpenF1 rate limit.

## Using it during a race

- Tap a car on the track or a row in the tower to select it. The selection is remembered on that phone.
- "Follow" keeps the camera centred on the selected car as it moves; "Reset view" returns to the overview.
- "Interval" in the tower header switches between the gap to the car ahead and the gap to the leader.
- In live mode, the delay buttons line the cars up with the broadcast. TV and streaming services usually run behind real time, so adding delay is the common adjustment.
- "Replay from start" re-runs the current session from lights out. "Go live" returns to the live edge.
- Settings has the session picker, the elevation scale, labels for every car, and the option to keep the screen awake.

## Limits worth knowing

- OpenF1 samples position and car data at about 3.7 Hz and publishes them about 3 s behind real time. The viewer interpolates between samples, so motion is smooth but approximate.
- Brake is on or off only. There is no tyre temperature, ERS or fuel data.
- DRS was replaced by active aero in 2026, so the DRS field is not shown.
- On the free tier, opening a replay takes about 20 s because requests are spaced to stay under 30 per minute.
- MQTT is tested against a local broker using OpenF1's documented connection details, not against the real broker. If it misbehaves on race night, set `LIVE_TRANSPORT=rest`; polling uses about 42 of the sponsor tier's 60 requests per minute.

## Developing without a live session

`mock/mock-openf1.js` imitates OpenF1, including the filter syntax, 404 for empty results and the live-window lock. It runs a fictional 20-car field with a finished Sprint and a Race that is live from the moment the mock starts.

```bash
npm install
npm run mock                     # mock OpenF1 on :4001
npm run dev                      # app on :3000 against the mock, free tier: Race is locked, Sprint replays
OPENF1_BASE=http://localhost:4001 OPENF1_USERNAME=any OPENF1_PASSWORD=any LIVE_TRANSPORT=rest npm start   # live mode
```

## Files

```
server.js            HTTP server, SSE stream, controls, password gate
lib/openf1.js        OpenF1 REST client: token flow, request spacing, retries
lib/feed.js          Session engine: clock, buffers, fetch scheduling, frames
lib/live-mqtt.js     OpenF1 MQTT client with token rotation
public/              Phone UI (three.js from jsDelivr, no build step)
mock/mock-openf1.js  Development stand-in for OpenF1
```
