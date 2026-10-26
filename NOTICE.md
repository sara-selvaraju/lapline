# Notices

Lapline's own code is under the MIT licence in `LICENSE`. That covers the code
only. Running it pulls in data and assets that come with their own terms, and
those bind anyone who runs a copy, fork or not.

## Data: OpenF1

Timing, position, telemetry and race control data come from
[OpenF1](https://openf1.org) at run time. OpenF1 is an unofficial community
project, and its data is licensed
[CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/): personal,
educational and non-commercial use, with attribution. Live data during a
session needs an OpenF1 sponsor account; past sessions are free. See
`docs/OPENF1.md`.

The MIT licence on the code does not extend to the data. If you run Lapline,
or anything built from it, against OpenF1, keep to OpenF1's terms.

No OpenF1 data is committed here. `design/sample-data.json` and everything
`tools/mock-openf1` serves are made up: an invented circuit and drivers.

## Circuit detail: MultiViewer

Corner numbers, marshal sectors and the circuit's rotation come from the
circuit info files OpenF1 links to, hosted by
[MultiViewer](https://multiviewer.app), fetched at run time and never stored in
this repo. Lapline has no agreement with MultiViewer, and copes without the
files when they are unavailable. See `apps/server/src/circuit/multiviewer.ts`.

## Font: Barlow Semi Condensed

`apps/web/public/fonts/` redistributes Barlow Semi Condensed, Copyright 2017
The Barlow Project Authors, under the SIL Open Font License 1.1. The licence is
in `apps/web/public/fonts/OFL.txt`.

## Trademarks

Lapline is unofficial and not affiliated with Formula 1. F1, Formula 1 and
related marks are trademarks of Formula One Licensing B.V. Nothing in the MIT
licence grants any right to them. The app carries no F1, Formula 1 or team
logos and no driver photos, and keeps "F1" out of its name and interface;
forks should do the same. Driver codes and team colours appear as factual
timing data.
