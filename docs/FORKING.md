# Forking Lapline

Lapline is MIT-licensed: fork it and change what you like. This is the short
guide to doing that: running it, deploying your own copy, and where to make
the two most likely kinds of change, to how it looks and to what it works
out. The deeper reference is `docs/ARCHITECTURE.md`.

One thing the licence cannot change: the data. OpenF1's data is for
non-commercial use, and that applies to any copy you run. See `NOTICE.md`.

## Run it

```
npm install
npm run dev                 # the mock, the server and the app, at http://localhost:5173
```

The mock drives a made-up circuit with a sprint to replay and a race that is
"live". Its first screen is **Live data locked**, because a live session needs
OpenF1 sponsor credentials. Tap **Replay sprint instead** and the cars start
moving. To watch the mock race live instead, give it any credentials (the mock
accepts anything) and use REST, which is all the mock speaks:

```
LIVE_TRANSPORT=rest OPENF1_USERNAME=x OPENF1_PASSWORD=x npm run dev
```

To watch a real past session, point the server at the real OpenF1, which
serves past sessions free, and pick one in Settings:

```
OPENF1_BASE= npm run dev
```

or pin one with `SESSION_KEY=<key>`, a session key from OpenF1's `sessions`
endpoint. Opening a real session takes 20 to 40 seconds on the free tier,
because requests are spaced out to stay inside its rate limit.

`npm test` runs the unit tests in a few seconds. The browser checks in `tools/`
(`npm run layout`, `scene`, `states`, `stale`, `rotate`) drive Chrome at phone
size; without Chrome installed, run `npx playwright install chromium` once and
set `PLAYWRIGHT_CHANNEL=` (empty) to use Playwright's own browser.

## Deploy your own

It is one Node service with no database. Any host that can do these will run
it:

- **Build** with `npm run build` and **start** with `npm start`, on Node 22.12
  or later. The server serves the built app itself.
- **Listen** on `PORT`. Health check: `GET /healthz`, which sits outside the
  password.
- **Don't buffer server-sent events.** `/events` is a long-lived stream at
  four frames a second; a proxy that buffers responses will freeze the cars.
  The server already sends `X-Accel-Buffering: no` for nginx.
- **Run one instance.** Session, clock and buffers live in memory, and the
  whole point is one upstream feed shared by every viewer. Two replicas would
  each spend their own OpenF1 rate limit and disagree about the clock.
- **Set `APP_PASSWORD`.** Without it the site is open to anyone who finds it,
  and anyone can change the session for every viewer. The server warns at
  start if it is empty. Set `SESSION_SECRET` to a long random string too.
- **Set `OPENF1_USERNAME` and `OPENF1_PASSWORD`** only if you have an OpenF1
  sponsor account and want live sessions. Without them, replays of past
  sessions work and live sessions show the locked screen.

`railway.json` is the config for Railway, which is what lapline.live runs on.
Elsewhere, the four lines above are all it needs. Every setting is listed under
"Configuration" in `docs/ARCHITECTURE.md`.

## Where to change what

| To change | Look in |
|---|---|
| How the track, cars, labels or cameras look | `apps/web/src/scene/` (`cars.ts`, `labels.ts`, `detail.ts`, `geometry.ts`, `Scene.ts`) |
| Colours, type and spacing | `apps/web/src/styles/tokens.css`, and `docs/DESIGN.md` for what each token is for |
| The panels around the track: tower, strip, sheets, screens | `apps/web/src/ui/`, one component per design area |
| What is worked out from the data: flags, laps, tyres, battles, qualifying | `apps/server/src/derive/`, pure functions with tests |
| How the circuit is built: outline, corners, sectors, pit lane | `apps/server/src/feed/track.ts` and `apps/server/src/circuit/` |
| What is fetched, when, and how often | `apps/server/src/feed/` (`schedule.ts`, `feed.ts`) |
| What goes over the wire | `packages/shared/src/protocol.ts` |
| Fake data for development | `tools/mock-openf1/` |

## Add something the engine works out

Battles — consecutive cars within a second of each other, under green — are a
complete small example of a derived value going end to end. A new one, say a
tyre-degradation estimate or an undercut window, takes the same five steps:

1. **Derive it** in a new file in `apps/server/src/derive/`, as a pure
   function of the buffers and a time: `battles(buffers, t)` in
   `derive/battles.ts`. Test it in `apps/server/test/`
   (`derive-rules.test.ts` has the battle rules) on rows small enough to read.
2. **Put it in a frame.** `buildTiming` in `apps/server/src/feed/frames.ts`
   calls it (`battles: battles(buffers, t)`). Per-car values at four frames a
   second go in `tick`; anything slower goes in `timing`, sent once a second.
3. **Add it to the protocol** in `packages/shared/src/protocol.ts`
   (`battles: z.array(z.number().int())` on the timing schema), and **bump
   `PROTOCOL_VERSION`**, so phones still running the old app reload rather
   than misread the new frames. Note the change in the version history in
   `docs/ARCHITECTURE.md`.
4. **Show it.** The store already holds the latest `timing`, so a component
   reads it with a selector: `useStore((s) => s.timing?.battles)` in
   `apps/web/src/ui/TimingTower.tsx`.
5. **Fix the fixtures.** Tests that build frames by hand (`frames`,
   `protocol` and `store` tests) need the new field; `npm run typecheck`
   points at each one.

If the value needs data that is not fetched yet, add the endpoint to the fetch
plan in `apps/server/src/feed/schedule.ts`, and read `docs/OPENF1.md` first:
it records how each endpoint behaves, and its quirks cost time to find.

## Replace or restyle the 3D view

The scene is plain three.js, deliberately outside React, because it draws at
the display's frame rate and must not wait on a render. The app talks to it
through one object, held in `apps/web/src/scene/instance.ts`, and calls only
these methods:

| Method | Called by | When |
|---|---|---|
| `new Scene(canvas)`, `dispose()` | `ui/TrackArea.tsx` | the track area mounts and unmounts |
| `setCircuit(circuit, zx, layers)` | `ui/TrackArea.tsx` | the outline, the elevation scale or the detail layers change |
| `setCamera(preset)` | `ui/TrackArea.tsx` | the viewer picks Map, Tilt or Chase |
| `pickCars(ndc)`, `ndcFor(event)` | `ui/TrackArea.tsx` | a tap, to find the cars under it |
| `setFrame(tick)` | `stream/sse.ts` | every position frame, four a second |
| `clearCars()` | `stream/sse.ts` | the field changes |

Everything else the scene needs, such as which car is selected, it reads from
the store each frame. So a different look for the cars or the track is a
change inside `scene/` alone. A different view altogether, a 2D map say, is
a class with those methods swapped in at `TrackArea.tsx`, and the server does
not change at all. The browser checks in `tools/` reach into the scene through
`window.__lapline.scene` to measure it, so a replacement view will fail them
until they are updated.

There is an empty `backgroundGroup` in `Scene.ts`, kept as the place for
anything drawn behind the track, such as terrain or buildings.

## Use a different data source

The server reads OpenF1 through one client, `apps/server/src/openf1/client.ts`,
and everything above it depends only on its `get` and a little auth state. The
cheapest swap is a server that answers OpenF1's endpoints in OpenF1's shape,
with `OPENF1_BASE` pointing at it; `tools/mock-openf1` is exactly that, and a
working template for serving recorded or different data.

## Worth keeping in a fork

- **Never call OpenF1 from the browser.** Credentials and the rate limit live
  on the server, and every request goes through the one queue in
  `apps/server/src/openf1/`.
- **Validate at the edges.** Upstream rows through zod, tolerantly; protocol
  messages on both sides.
- **No F1, Formula 1 or team logos, and no driver photos,** and keep "F1" out
  of your app's name. They are trademarks; see `NOTICE.md`.

`AGENTS.md` has the full working rules, written for coding agents but as true
for people.
