# Lapline design spec

The source of truth is the design canvas "Lapline redesign" (link in `design/README.md`). Its artboard sources are in `design/artboards/` and use inline styles, so every size and colour below can be checked there. Where this file and an artboard disagree, the artboard wins; flag the conflict.

## Context the design answers to

- A single viewer, phone upright, one thumb, often in a dark room, glancing for two to five seconds while watching the TV.
- Job order: who is where and in what order; how the selected driver is doing; race state; staying in sync with the broadcast.
- The 3D circuit is the one memorable element. Everything else stays quiet.

## Tokens

### Colour

| Token | Hex | Use |
|---|---|---|
| `night` | `#0E1626` | Page ground, scene clear colour |
| `panel` | `#15213A` | Driver strip, sheets, bars, selected tower row |
| `line` | `#283857` | Borders, dividers, scene ground line |
| `line-strong` | `#3A4D74` | Turn badge borders |
| `flood` | `#F2EBDD` | Track ribbon, primary text, primary buttons |
| `text-2` | `#C9D1DE` | Secondary values (intervals, annotations) |
| `haze` | `#8C9AB5` | Labels and units, tertiary text |
| `green` | `#2BB673` | Track green, throttle |
| `yellow` | `#F5B700` | Yellow, SC and VSC, reconnecting |
| `red` | `#E5383B` | Red flag, brake, live dot |
| `white` | `#FFFFFF` | Red flag band text only, where `RedFlag.dc.html` overrides `flood` |
| `purple` | `#B794FF` | Fastest lap of the session |
| `pb` | `#4CD08E` | Personal best lap |
| `tyre-soft` | `#FF4D4F` | |
| `tyre-medium` | `#FFD12E` | |
| `tyre-hard` | `#F2EBDD` | |
| `tyre-inter` | `#3CC35A` | |
| `tyre-wet` | `#2E8BFF` | |
| `label-bg` | `rgba(14,22,38,.88)` | Car labels on the track |
| `backdrop` | `rgba(5,9,18,.55)` | Behind sheets |

Flag colours mean state and nothing else. Team colours come from the data.

### Type

Barlow Semi Condensed, weights 400, 500, 600 and 700, with tabular figures everywhere (`font-variant-numeric: tabular-nums`).

| Size (px) | Use |
|---|---|
| 60 | Speed and gear, telemetry panel |
| 44 | Lap number, glance mode |
| 36 | Speed and gear, driver strip |
| 24 | Driver code in the strip, sheet titles, state headings |
| 21 | Circuit name in the header |
| 18 | Body copy in sheets and state screens |
| 17 | Tower rows, header lap count |
| 16 | Buttons, flag band label |
| 15 | Secondary text, race control line |
| 14 | Field labels, tower header |
| 13 | Units, car labels on the track |
| 12 | Track annotations (sectors, pit lane), small chips |
| 10 to 11 | Turn badges, tyre letters |

### Shape and spacing

- Side gutter 16 px in portrait, 12 px in landscape.
- Touch targets at least 44 px. Segmented camera buttons are 38 px inside a 44 px group.
- Radius: 4 for car labels and chips, 9 to 12 for buttons and the camera group, 14 for cards and list groups, 16 to 20 for sheets, full circles for badges, tyres and car dots.

## Layout, portrait (390 × 844)

| Area | Height | Notes |
|---|---|---|
| Flag band | 4 px green; 28 px with a label in any other state | Always visible |
| Header | 56 | Circuit, lap `n/total`, live pill (dot, "Live", "10 s behind"), menu |
| Track | 290 | Camera group top right; race control line along the bottom edge |
| Driver strip | 88 | Swatch, position, code, interval; speed; gear; throttle and brake bars; tyre and age; expand control |
| Tower | the rest | Header row 30, rows 36. About nine rows show |
| Controls bar | 68 live, about 90 replay | Live: "Matching TV at 10 s behind", −, +, Sync. Replay: scrubber row and transport row |

Landscape (844 × 390) puts the track on the left at 470 px, and the live pill, driver strip and tower on the right. Glance mode shows the top five in 40 px type beside a flat map of the leaders.

## The track drawing

| Layer | Spec |
|---|---|
| Ribbon | `flood`, about 3.4 px at default zoom |
| Glow | `flood` at 10%, about 11 px wide, under the ribbon. Tinted `yellow` at 12% under a safety car |
| Elevation | A ground line in `line` under the track and vertical posts at 14% `flood` every 5% of the lap. Default exaggeration 4×, adjustable from 1 to 12× |
| Turn badges | 17 px circles, `panel` fill, 1 px `line-strong` border, number in 10 px bold `text-2`, placed about 14 px outward from the apex and nudged clear of car labels and controls |
| Sector boundaries | 2.2 px `flood` ticks across the track, labelled S1 (at the line), S2 and S3 in 12 px 600 `text-2` |
| Marshal sectors | 1 px `haze` ticks at 45% |
| Start/finish | A short bar across the track, alternating `flood` and `night` |
| Direction | A small `haze` chevron just after the line |
| Pit lane | Dashed 1.6 px `haze` (3 on, 3 off) inside the main straight, labelled "Pit lane". Brighter, labelled "Pit lane open", under a safety car |
| Local yellow | The marshal sector overlaid 5 px `yellow` with a "Yellow" chip |
| Red flag incident | The affected section overlaid 4 px `red` with an "Incident, turn n" chip; cars queue along the pit lane |
| Speed trap | A tick and label on the fastest straight. Keep only if a real position can be sourced |

Each detail layer (turns, sectors, pit lane) is a viewer preference, on by default.

### Cars

- A 10 px dot in the team colour, with a 1.5 px `night` outline.
- **Selected:** a 16 px `flood` ring, and a label in inverted style (`flood` ground, `night` text, 15 px bold, 3 px team-colour underline).
- **Other labels:** 13 px bold on `label-bg`, with a 2 px team-colour underline.
- **Label rule:** the leader, the selected car, and cars within 1.0 s of the selected car. The "Label every car" setting overrides it. Labels avoid each other in screen space.
- **Stale:** below 45% opacity and greyed when the newest sample is over 8 s old.
- **Safety car:** a `yellow` diamond with an "SC" chip ahead of the leader.
- **Bunches:** when several cars overlap, a "+n cars" chip; tapping it opens the car picker.

## Timing tower

Columns in portrait: position 26 (right-aligned, `haze`), team swatch 4 × 20, code (bold) with an optional "Pit" badge, interval 78 (right), tyre 52, last lap 70 (right).

- **Interval or gap:** the column header toggles between interval and gap to leader.
- **Battles:** an interval under 1.0 s, under green only, gets a `line` chip behind the number in `flood`.
- **Lap times:** `haze` by default. `purple` only for the session's fastest lap, and `pb` only for a personal best, each on the lap just completed. Everything else stays uncoloured.
- **Tyre:** a 19 px ring in the compound colour with its letter, plus age in laps.
- **Selected row:** `panel` background.
- **State variants:** "Pits" column under a safety car, "Gap at red flag" under a red flag, "Gap to winner" and "Stops" when finished.

## Interactions

| Control | Behaviour |
|---|---|
| Tap a car or a tower row | Selects it; remembered on the phone |
| Tap a "+n cars" chip or a bunch | Opens the car picker, a list of those cars at 48 px per row |
| Camera group | Map (top-down), Tilt (default), Chase (low, behind the selected car). Manual orbit, pinch and pan still work, and the preset button deselects when the viewer orbits |
| Driver strip chevron | Expands the telemetry panel: 60 px speed and gear; throttle, brake and RPM bars; a 30 s speed trace with braking zones; and stats for the car ahead, the car behind, the gap to the leader, last, best and tyre |
| Telemetry ↑ and ↓ | Selects the car ahead or behind |
| Live pill or Sync button | Opens "Sync with TV": tap when the leader crosses the line on TV. The delay is set from that tap, then fine-tuned with ±1 s and ±5 s. Minimum 4 s |
| − and + in the controls bar | Delay ±1 s |
| Replay transport | Play or pause, ±10 s, a speed cycle (1×, 2×, 4×, 8×, 16×), and a scrubber marked with SC periods (`yellow`), VSC periods (dim `yellow`) and red flags (a `red` tick) |
| Menu | Settings: session list grouped by weekend, follow live sessions, keep screen on, label every car, elevation scale, replay from the start, data status line |

Motion: car positions interpolate between 4 Hz frames; the flag band changes height and colour over 200 to 300 ms. No other ambient motion. Respect reduced-motion settings.

## States and their artboards

| State | Artboard |
|---|---|
| Live, green, driver selected | `Main.dc.html` |
| Telemetry expanded | `DriverDetail.dc.html` |
| Sync with TV (interactive) | `SyncSheet.dc.html` |
| Car picker | `CarPicker.dc.html` |
| Safety car | `SafetyCar.dc.html` |
| Red flag | `RedFlag.dc.html` |
| Chequered flag | `Finished.dc.html` |
| Replay (interactive) | `Replay.dc.html` |
| Loading, with staged progress | `Loading.dc.html` |
| Connection lost, last known positions | `Reconnecting.dc.html` |
| Locked: live window without sponsor access | `Locked.dc.html` |
| Settings | `Settings.dc.html` |
| Live, landscape | `LiveLandscape.dc.html` |
| Glance mode, landscape | `Glance.dc.html` |

VSC, VSC ending, safety car ending and yellow use the safety car layout with their own band label and colour.

## Copy

- Sentence case, plain verbs, Australian English. Times shown in the viewer's local time.
- Race control messages arrive in capitals; show them in sentence case.
- No F1 logos, team logos or driver photos. Never put "F1" or "Formula 1" in the product name or UI chrome.
- Errors say what happened and what to do next, for example "No new data for 18 s. Showing the last known positions. Trying again every 3 s."

## Open design questions

- **The "ending" bands have no artboard.** `SC ENDING` and `VSC ENDING` keep
  the safety car's yellow ground and differ only by label, which is what the
  states table above asks for, but no artboard draws them. Judge them on a
  device during a race.
- **The red flag card's reason line** is race control's own message, in
  sentence case. `RedFlag.dc.html` writes "Barrier repair at turn 7. Restart
  time to be confirmed.", which no feed publishes; inventing it would be worse
  than quoting what was actually said.
- **Cars under a red flag** are drawn where the data puts them. The artboard
  queues them along the pit lane, which is where they really go, so real
  positions should show that without being told to; a synthetic queue would be
  inventing positions.
- **The driver strip under a red flag** keeps its usual shape rather than the
  artboard's "Stopped in the pit lane" restructure. A stopped car reads 0 km/h
  and neutral already, which says the same thing with real numbers.
- **The safety car marker** is placed just ahead of the leader, as the cars
  section specifies, because OpenF1 publishes no safety car position. It marks
  where the field is being held, not where the car is.

- **Glance mode entry:** the artboard shows how to leave it, not how to enter it. Suggestion: a "Glance" option in landscape.
- **Chase camera:** specified but not drawn. Build it and judge it on a device.
- **Grid size:** mock-ups show 20 cars; the 2026 grid is 22. Check tower density with 22.
- **Daytime races:** the palette is designed for night. Check contrast outdoors before adding a light theme.
