# Design assets

## The canvas

The live design is the "Lapline redesign" canvas in Claude:
https://claude.ai/artifact/1aJhnpYKcFBtHyFBRmaBZK

It's private to its owner. The files here are a snapshot of it from 11 October 2026.

## What's in this folder

| Path | What it is |
|---|---|
| `artboards/*.dc.html` | The source of each screen. Layout, sizes and colours are inline styles, so read them as the exact spec. Mock data for each screen sits in the `renderVals()` function at the bottom |
| `artboards/canvas.json` | Canvas index: each artboard's size, title and position |
| `screens/` | Empty. Put PNG exports of the artboards here (see below) |
| `sample-data.json` | Real payloads from the prototype's stream: `hello`-style init, a tick with timing, and a positions-only tick. The prototype's shape, not protocol v1 |

## Reading the artboards

- They depend on the canvas's own runtime (`support.js`, not included), so they won't render if opened directly in a browser. Read them as source, or view them on the canvas.
- The track in each artboard is an SVG illustration of an invented circuit, standing in for the three.js scene. Match its styling (stroke widths, colours, badge sizes, label rules), not its geometry.
- Driver codes, teams and lap times are fictional.
- `SyncSheet.dc.html` and `Replay.dc.html` contain working interactions; their `renderVals()` shows the intended state changes.

## Exporting screens

To have pixel references beside the code, export the artboards from the canvas as PNG images and save them in `screens/`, named after the artboard (for example `Main.png`). Claude Code can then compare build screenshots against them.
