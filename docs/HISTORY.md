# Build history

The status log from `AGENTS.md` as it stood when the last milestone closed,
kept for the reasoning behind the code: what M8 and M9 found, what broke, and
what was measured. It was written as it happened, so "next" and "now" mean
then. Earlier milestones are recorded in their commit messages. The milestones
and their acceptance checks are in `docs/BUILD-PLAN.md`; the current state is
in `AGENTS.md`.

## M9, race-night hardening

M9 done. A full live session watched on a phone with no manual intervention —
the Austin race on 25 October 2026 — kept up with the broadcast from start to
finish, and nothing was seen to go wrong. The frame rate read off the settings
page during the race, with a full field, Tilt view and all three detail layers
on, was a steady 60 fps, which closes "60 fps on a recent iPhone", open since
M2. Railway showed resident memory flat at about 150 to 157 MB, in line with
the mock soak's peak.

**Not done at Austin:** the soak against the real feed. The request rate
against the sponsor budget, frame size on a live race and the reconnect count
over a real weekend are still the mock's and the Singapore replay's. Run it at
the next race:

```
npm run soak -- --url https://lapline.live --minutes 240 --out race.ndjson
```

and add the numbers to "Measured" in `docs/ARCHITECTURE.md`.

What M9 found and fixed is in six commits. On the server: a lock could not be
left, so a single 401 from a token refresh ended the session for good; pruning
ran below the idle guard, so a sleeping phone left MQTT filling buffers that
nothing trimmed; the fetch loop pushed a settled timer onto an array every
second; MQTT's first connection had no retry; and one listener throwing cost
every listener after it in the set that frame. On the client: every rebuild of
the track leaked 7 geometries and 10 textures, and `setCircuit` runs on each
nudge of the elevation slider, not just on a change of circuit. Six new server
tests and three new scene checks cover these, and most fail without their fix.
Dedupe keys were also capped at a flat 200,000, which was 45 minutes of keys
against buffers holding 90 seconds of rows; the cap now scales to what is
retained, and the clear gave back 10.7 MB of heap.

**The mock soak ran for 2.8 hours and is the baseline for the real feed.** One
listener held open throughout: no reconnects, no errors, 4.0 ticks a second
from start to finish, and a worst gap between ticks of 0.3 s against a 0.25 s
cadence. Resident memory rose 92.5 to 132.5 MB through the live session as it
filled with history and then went flat; the replay afterwards peaked at 152.5
and gave it back, ending at 102.6 with the final hour at -1.0 MB an hour. File
descriptors stayed between 24 and 26. **The live-to-replay handover survived**
— the transition that caused M1's 422 — with requests dropping from 46 a minute
to 4 and the stream never breaking stride.

Frame size, which M9 asks for and nothing had measured: against the deployed
site replaying Singapore with 22 cars, 7.7 kB/s all up — tick 1,090 B at 4 Hz,
timing 3,349 B at 1 Hz, hello 14,979 B once. A two-hour race is about 56 MB of
mobile data. All of it is in `docs/ARCHITECTURE.md` under "Measured".

MQTT against OpenF1's real broker, M9's first bullet, was already met during
the Singapore race on 11 October — see `docs/OPENF1.md`. The line that used to
say this project could not close that check locally was out of date and is
gone.

## M8, landscape and glance

M8 done. Landscape is a reflow of the same tree rather than a second layout —
the track on the left at 470 px with the tower beside it — and glance mode
shows the top five in large type beside a flat map, entered from a button in
the landscape pill row and left by rotating back. Any window wider than tall
gets landscape, a laptop included. Next is M9 in `docs/BUILD-PLAN.md`.

The acceptance check is automated as `npm run rotate`: it rotates one live
page rather than loading two, and asserts the same `Scene` object survives,
the cars are not rebuilt, the selection and camera preset are kept, and no new
`EventSource` is ever opened. `npm run layout --landscape` measures the two
columns against `LiveLandscape.dc.html`.

Landscape was not merely plain before this — it was broken. The fixed regions
totalled 506 px against 390 of height with nothing allowed to shrink, so the
tower collapsed to nothing and the controls bar was clipped off the screen.

## Notes carried from earlier milestones

**Unverified:** the home-screen half of M7's password check. The frame rate,
also once unverified, was measured on a phone at Austin: 60 fps.

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
