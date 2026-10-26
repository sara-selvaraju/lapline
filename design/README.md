# Design assets

## Where the design lives

The artboards here are the design. They were exported from a design canvas
that is private to its owner, so this folder is the public copy, and the one
the code is checked against.

## What's in this folder

| Path | What it is |
|---|---|
| `artboards/*.dc.html` | The source of each screen. Layout, sizes and colours are inline styles, so read them as the exact spec. Mock data for each screen sits in the `renderVals()` function at the bottom |
| `artboards/canvas.json` | Canvas index: each artboard's size, title and position |
| `screens/` | Not committed. Where `npm run screenshot` and `npm run states -- --shots design/screens` write their captures, for comparing against the artboards locally. The artboards are the spec |
| `sample-data.json` | Payloads from the prototype's stream against the mock, so the session, circuit and drivers are made up: a `hello`-style init, a tick with timing, and a positions-only tick. The prototype's shape, not the current protocol |

## Reading the artboards

- They depend on the canvas's own runtime (`support.js`, not included), so they won't render if opened directly in a browser. Read them as source, or view them on the canvas.
- The track in each artboard is an SVG illustration of an invented circuit, standing in for the three.js scene. Match its styling (stroke widths, colours, badge sizes, label rules), not its geometry.
- Driver codes, teams and lap times are fictional.
- `SyncSheet.dc.html` and `Replay.dc.html` contain working interactions; their `renderVals()` shows the intended state changes.

## Checking the build against them

`npm run layout` measures the rendered app against the artboards' inline sizes,
and `npm run states` walks every race state against its artboard. Both are
described in `AGENTS.md`.
