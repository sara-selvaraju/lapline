# OpenF1 notes

Everything here was checked against openf1.org and its docs on 11 October 2026. Where something is unverified, it says so. Re-check the docs at https://openf1.org/docs before relying on a detail that matters.

## Terms and access

- An unofficial, community project, not affiliated with Formula 1. Data is licensed CC BY-NC-SA 4.0 and intended for personal, educational and non-commercial use. Lapline stays inside that.
- **Free tier:** all historical data since 2023, no authentication, up to 3 requests a second and 30 a minute.
- **Sponsor tier (€9.90 a month):** adds live data during sessions over REST, MQTT and WebSocket; up to 6 requests a second and 60 a minute; up to 10 concurrent MQTT or WebSocket connections.
- **Live window:** data counts as live from 30 minutes before a session starts until 30 minutes after it ends. Inside the window, unauthenticated requests are refused. Outside it, the same data is free.
- Live data typically arrives about 3 seconds after real time.

## Authentication

```
POST https://api.openf1.org/token
Content-Type: application/x-www-form-urlencoded
username=…&password=…

→ { "access_token": "…", "expires_in": "3600", "token_type": "bearer" }
```

- REST: `Authorization: Bearer <token>`.
- Tokens last one hour. Refresh before expiry.
- Credentials and tokens stay server-side, which OpenF1's own guidance also requires.

## MQTT (live)

- MQTTS: `mqtt.openf1.org:8883`. WebSocket: `wss://mqtt.openf1.org:8084/mqtt`. Lapline uses the WebSocket URL, which passes through hosting networks more reliably.
- Username: the account username. Password: the access token.
- Topics mirror REST paths: `v1/location`, `v1/car_data`, `v1/position`, `v1/intervals`, `v1/race_control`, `v1/pit`, `v1/laps`, `v1/stints` and so on.
- Messages are the REST row plus `_id` (increasing) and `_key` (document identity). Rows with the same `_key` are updates to one document; `v1/laps` relies on this as sectors complete. Upsert laps by driver and lap number.
- Lapline's MQTT client has only been tested against a local broker, not OpenF1's. Verify it during the first live session.

## REST conventions

- Base: `https://api.openf1.org/v1/<endpoint>`.
- Filters on any non-array field: `field=value`, `field>value`, `field>=value`, `field<value`, `field<=value`. Repeat the field for ranges, for example `date>=…&date<…`.
- Browsers and `fetch` percent-encode `<` and `>`. OpenF1 accepts the encoded form (`date%3E=…`).
- Dates: anything `dateutil` parses. Send ISO 8601 in UTC with `Z`, and avoid `+00:00` in query strings, because `+` can decode as a space.
- `session_key=latest` and `meeting_key=latest` select the current or most recent one.
- **An empty result returns HTTP 404**, not an empty array. Treat it as no rows.
- Add `csv=true` for CSV output.
- Sessions and meetings refresh daily at midnight UTC, so a weekend's sessions are listed before they start.

## Endpoints Lapline uses

| Endpoint | Key fields | Notes |
|---|---|---|
| `sessions` | `session_key`, `session_name`, `session_type`, `date_start`, `date_end`, `meeting_key`, `circuit_key`, `circuit_short_name`, `country_name`, `year`, `is_cancelled` | `date_end` is scheduled; races can overrun |
| `meetings` | `meeting_key`, `meeting_name`, `circuit_key`, `circuit_info_url`, `gmt_offset`, `date_start`, `date_end` | `circuit_info_url` feeds the circuit detail (see below) |
| `drivers` | `driver_number`, `name_acronym`, `full_name`, `broadcast_name`, `team_name`, `team_colour` (hex, no `#`) | Per session |
| `location` | `date`, `driver_number`, `x`, `y`, `z` | About 3.7 Hz. Origin is arbitrary. Units look like decimetres. No lateral placement. Rows of 0,0,0 mean no fix |
| `car_data` | `date`, `driver_number`, `speed` (km/h), `rpm`, `n_gear` (0 = neutral), `throttle` (0 to 100), `brake` (0 or 100), `drs` | About 3.7 Hz. DRS no longer exists from 2026; ignore the field |
| `position` | `date`, `driver_number`, `position` | Changes only |
| `intervals` | `date`, `driver_number`, `gap_to_leader`, `interval` | Races only, about every 4 s. Values are seconds, or text such as `+1 LAP`, or null for the leader |
| `laps` | `driver_number`, `lap_number`, `date_start` (approximate), `lap_duration`, `duration_sector_1..3`, `is_pit_out_lap`, `i1_speed`, `i2_speed`, `st_speed`, `segments_sector_*` | Mini-sector segments are not available during races |
| `stints` | `driver_number`, `stint_number`, `compound`, `lap_start`, `lap_end`, `tyre_age_at_start` | `lap_end` null while running |
| `pit` | `date`, `driver_number`, `lap_number`, `lane_duration`, `stop_duration` | `pit_duration` is deprecated and goes at the end of the 2026 season; use `lane_duration` |
| `race_control` | `date`, `category`, `flag`, `scope`, `sector`, `driver_number`, `lap_number`, `message` | Categories include `Flag`, `SafetyCar`, `SessionStatus`, `CarEvent`. Scope `Track`, `Sector` or `Driver`. `sector` is the marshal sector |

Not used yet, but available: `weather`, `team_radio` (coverage dropped sharply in 2026), `overtakes`, `session_result`, `starting_grid`, `championship_drivers` and `championship_teams` (both beta).

## Circuit detail via `circuit_info_url`

- Each meeting links to a JSON file hosted by MultiViewer, in the format FastF1 documents as circuit info: corners with numbers and positions, marshal lights, marshal sectors, and a rotation for orienting the map.
- **Verified on 11 October 2026**, against the Singapore meeting (`circuit_info_url` → `api.multiviewer.app/api/v1/circuits/61/2026`). It returns 200 with no special headers; the earlier note that automated access was refused is out of date.
- The response carries `corners` (19 at Singapore), `marshalSectors` (16), `marshalLights` (16), a `rotation`, a 544-point `x`/`y` trace, `trackPositionTime` along that trace, and `pitLoss` for normal, SC and VSC.
- **Corner coordinates do share OpenF1's location frame** — same origin, same scale. Checked by overlaying the 19 corners on a real Singapore lap trace: median distance to the racing line 24 units, worst 64, against a circuit spanning 14,391. Worst case is 0.45% of the circuit.
- Fetch it server-side once per meeting and cache it, including failures, so a meeting without one is not retried on every session change. It is not OpenF1, so it must not go through the OpenF1 request queue.
- If it fails, turns are derived from curvature on our own outline. That fallback finds about two thirds of a street circuit's corners — 12 at Singapore against the 19 the file lists — so it is a degraded mode, not an equivalent.
- No sector boundaries are published by either source. They have to be derived from a reference lap's sector durations.

## Volumes and budgets

- One race of location plus car data is about a million rows for 22 cars over two hours.
- Replay windows: all cars for 30 s of session time is about 2,400 rows per endpoint per request.
- **Free-tier replay:** opening a session costs about 8 requests (drivers, laps, stints, position, intervals, race control, pit, one reference-lap trace), which is around 20 s at 2.1 s spacing.
- **Live REST fallback:** about 42 requests a minute, measured against the mock.

## 2026 changes worth knowing

- DRS has been replaced by active aero. Ignore the `drs` field.
- Team radio is rarely released from 2026 onwards.
- `country_code` on drivers and `pit_duration` on pits are deprecated and will be removed after the 2026 season.
