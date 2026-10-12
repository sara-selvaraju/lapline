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
- **Verified against OpenF1's real broker on 11 October 2026**, during the Singapore race. The feed switched to live by itself when the window opened, reported `mqtt: true`, and streamed 22 cars at 4 Hz with a 2 s data age. The earlier note that it had only met a local broker no longer applies.

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
| `location` | `date`, `driver_number`, `x`, `y`, `z` | About 3.7 Hz. Origin is arbitrary. **Units are decimetres** (measured, see below). No lateral placement. Rows of 0,0,0 mean no fix |
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

## Coordinates are decimetres

- Measured on 13 October 2026, not assumed. Singapore's outline traces 49,641 units against an official lap of 4,940 m: **10.05 units per metre**. The earlier note said "units look like decimetres"; they are.
- So a path length converts straight to a distance. The sync sheet uses it to say how far the leader is from the line, and the lap comes out at 4,977 m against the official 4,940 — 0.7% long, which is the sampling error of a 3.7 Hz trace rather than a scale problem.

## Lap start times are good enough to sync by

- `laps.date_start` is documented as approximate, and it is, but it is consistent: across Singapore's 62 laps each start matches the previous start plus its duration to within 350 ms, mean 72 ms.
- That is what "Sync with TV" rests on, and it is well inside the ±1 s the build plan asks for.

## The pit lane, from position traces

- Neither OpenF1 nor the circuit file publishes a pit-lane path. It is derived from a car's own trace through a stop: `pit` gives the time and `lane_duration`, `location` gives the positions, and the samples that do not lie on the racing line are the lane.
- **Measure the offset to the outline's segments, not its points.** The outline is sampled at about 3.7 Hz, so its points sit tens of units apart on a straight and far more at speed; nearest-*point* distance therefore measures the sampling gap as much as any lateral offset. On a clean Singapore lap it reaches 396 units with the car on the racing line throughout, which overlaps the pit lap entirely and makes the two indistinguishable. Nearest-*segment* distance is the real perpendicular offset.
- **Verified on 12 October 2026** against the Singapore race (session 11388). Measured to segments, a clean racing lap never exceeds 42 units off the outline, while the lap with the stop sits at a median of 117 and a maximum of 186. A threshold of 0.4% of the circuit's longer axis (57 units at Singapore) separates them with no false positives.
- The result is a single contiguous run of samples: 115 points over 33 s, 6,813 units long, 47% of the circuit's longer axis, with no reversals.
- The threshold is scale-relative for the same reason the corner threshold is: coordinates are in whatever units the circuit uses, so an absolute figure is a figure about one circuit.
- It costs one extra `location` request per session, and only once a stop has happened, so a session with no stops yet costs nothing.

## Position data is not always usable

Checked across eighteen circuits on 12 October 2026 with `npm run circuits`, which runs the shipped pipeline against real sessions. Fourteen were clean. The exceptions matter more than the average.

- **A session can have no `location` at all.** Monaco 2026 (meeting 1286) returns 404 for location on every session of the weekend — practice, qualifying and race — while laps, timing and telemetry are all present. No outline can ever be built there.
- **A session can have `location` that is worse than none.** Hungary 2026 (session 11342) serves a full complement of rows whose positions repeat only 26 values around the lap: x and y freeze while z keeps counting, then jump to catch up. Every driver and every lap is affected identically, so retrying does not help. A row count cannot tell this apart from a good lap, and it produced corners 11% of the circuit out of place and a pit lane derived from a clean racing lap.
- **So a trace is judged, not counted.** Across the fourteen good circuits, 99–100% of a lap's samples are distinct positions and the largest step between samples is 3.5% to 6.1% of the circuit's longer axis. Hungary sits at 8% distinct and a 28.7% jump. `usableTrace` in `apps/server/src/feed/track.ts` gates on 60% distinct and a 15% step, which is roughly 2.5× clear of both ends.
- Where a lap is rejected, the next-fastest is tried, up to three. Where all three fail, the viewer is told the session has no usable positions, and we stop asking — the tower and telemetry still work, so it is a degraded session rather than a broken one.

## Circuits without a `circuit_info_url`

- Two of the 2026 circuits have no MultiViewer file: **Madring** (Madrid) and **Kuala Lumpur**, both new that season. The meeting carries no `circuit_info_url` and the request 404s.
- Both fall back to curvature on our own outline, which found 14 and 13 turns respectively. That is the degraded mode described above: positions are right, numbering is not authoritative, and there are no marshal sectors.
- Expect this for any circuit new to the calendar, and re-check before its first race weekend.

## Volumes and budgets

- One race of location plus car data is about a million rows for 22 cars over two hours.
- Replay windows: all cars for 30 s of session time is about 2,400 rows per endpoint per request.
- **Free-tier replay:** opening a session costs about 8 requests (drivers, laps, stints, position, intervals, race control, pit, one reference-lap trace), which is around 20 s at 2.1 s spacing.
- **Live REST fallback:** 44.5 requests a minute, measured against the mock, confirmed from two independent counts.
- **Live over MQTT:** 2.5 requests a minute, measured against the real Singapore race. With the broker carrying the stream the scheduler drops to a slow repair sweep, so it spends about 4% of the sponsor budget rather than 73%.

## 2026 changes worth knowing

- DRS has been replaced by active aero. Ignore the `drs` field.
- Team radio is rarely released from 2026 onwards.
- `country_code` on drivers and `pit_duration` on pits are deprecated and will be removed after the 2026 season.
