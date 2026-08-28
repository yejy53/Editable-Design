# poster-starter

A fixed-canvas poster project. The visual system may combine generated artwork,
live typography, and HTML geometry, and the included scripts make the render
reproducible.

## Prerequisites

- A Chromium-based browser (Google Chrome, Chromium, Edge, Brave)
- Set `POSTER_BROWSER=<path to executable>` if it is somewhere unusual

## Quick start

```bash
scripts/check-poster.sh index.html
scripts/render-poster.sh index.html                # defaults to out/poster.png
scripts/render-poster.sh index.html out/print.png --dpi 300
scripts/render-poster.sh --probe
```

`scripts/render-poster.sh` reads the PNG's real pixel dimensions back and compares them
with `poster.json`. A browser silently returns a different size when the window
and the content disagree, and the image looks perfectly normal, so this check is
not optional.

## What is here

- `index.html` — one file, CSS inline, zero external requests. Absolute
  positioning inside the canvas, fixed px for every layout dimension
- `poster.json` — canvas size, render scale, print DPI. The renderer takes its
  expected dimensions from here
- `assets/` — generated or provided visual assets, referenced by relative path
- `reference/` — optional non-shipping composition references
- `scripts/` — local validation, asset import, tracing, and PNG rendering tools
- `editor.html` — generated at delivery time; drag layers, resize width and
  height with eight handles, double-click text, adjust type, delete, undo, scan
  and dynamically spread/collapse the layers, and download clean edited or
  exploded HTML
- `layers.html` — standalone animated layer breakdown generated at delivery
- `brief.md` — written at the start of a real run from the active user request;
  the starter does not ship a placeholder because Replay evidence must be real
- `replay/` — generated after verification; a fixed offline viewer populated
  from the run's real prompts, plans, assets, code, review, and layer output

Import a selected generated image immediately rather than leaving the project
dependent on an image-generator cache path:

```bash
scripts/import-asset.sh /path/to/generated.png assets/visual-01.png
```

After the final render has passed visual review, create the editor companion:

```bash
node scripts/wire-editor.mjs index.html
```

The complete editor runtime is bundled with `poster-building` and copied into
the project during initialization, so no second skill is required and the
project remains usable offline. The original `index.html` is never modified by
editor wiring.

After verification, generate and check the Agent Design Replay:

```bash
node scripts/build-replay.mjs .
node scripts/verify-replay.mjs replay/index.html
```

## Contract

- The root element carries `data-canvas-width` / `data-canvas-height`, its
  `width`/`height` are the same px values, and it is `position: relative`
- Fixed px for every dimension, position, and gap that carries layout. No
  vw/vh/vmin/vmax/%. Decorative values (gradient stops, radii, shadow spread,
  texture sizes) are unrestricted
- No interactivity, no media queries, no CDN
- Nothing extends past the canvas edge

## The placeholder layout is temporary

`.preview-frame`, `.preview-status`, and the placeholder strings are scaffolding,
not product. Once the first real version replaces them, delete those blocks and
their CSS, delete `<meta name="poster-preview">`, replace `<title>` and the
placeholder strings with the poster's real title and live HTML text, and delete
every unreferenced file in `assets/`. Record the sweep in
`cleanup-checklist.json`.

The preview demonstrates the fixed canvas and safe area only. It is not a
recommendation for a full-bleed image, banded composition, asset count, text
placement, or final geometry. Build those decisions from the brief and visual
reference.
