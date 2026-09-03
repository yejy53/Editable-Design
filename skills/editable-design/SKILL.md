---
name: editable-design
description: Create and render fixed-canvas editable visual designs, including posters, marketing graphics, covers, menus, banners, and social cards. Default outputs include fixed and editable HTML, PNG, a mouse editor with scan and exploded layer views, and an evidence-backed Design Replay. Do not use for websites, slide decks, videos, or standalone logo systems. Always use this skill when the project contains `poster.json`.
---

# Editable Design

Design the complete requested fixed-canvas visual, verify it, then deliver it. The default
deliverable is a fixed-canvas `index.html`, a mouse-editable `editor.html` with
scan and exploded-layer views, a poster-specific visual system built from
generated artwork, live typography, and/or HTML geometry, and a rendered PNG.
It also includes `replay/index.html`, a deterministic visual account of the real
input, reference, plan, asset prompts, code, review, and layer output, plus a
standalone animated `layers.html` breakdown.

## Communicate clearly

Assume the user is a nontechnical knowledge worker. Talk about their poster,
choices, progress, and results. Keep tools, commands, files, renderers, browser
software, dependencies, source control, paths, and exit codes out of user-facing
messages unless the user asks or must take action.

Use no more than one short update for each user-visible phase: preparing,
designing, and delivering. If a phase takes longer than 60 seconds, give one
plain-language update. Keep recoverable technical problems private; say only that
you hit a problem and are trying another method.

**You are the designer, not a consultant.** Decide the layout, hierarchy,
palette, type, composition, and white space yourself. Do not generate design
options or pause for a visual selection unless the user explicitly asks to
compare designs. When undecided, pick one and say why; do not hand the choice
back.

Ask one concise group of up to three discovery questions only when the missing
information would materially change the finished poster or force you to invent
something. **The only thing you must ask about is fact**: prices, dates and
times, locations, contact details, exact brand and product names, legal notices.
Inventing one of those ships a falsehood, which is worse than leaving it out.
Everything else is a judgement call, and judgement is your job.

## Choose the execution path

Use the **one-shot fast path** only when all of these are true:

- this is a new poster in an empty or projectless workspace;
- the layout needs no generated shipping imagery, because type, colour, or CSS
  shapes carry it;
- the request does not involve multiple artwork slots, a cutout subject, print
  DPI, or revising an existing poster; and
- the deliverable is a single screen-resolution render.

Use the **capability path** otherwise.

## Prepare academic PDF inputs

When the source is a research-paper PDF, complete a compact evidence pass before
the reference or design plan. Read the whole paper's text structure and inspect
the pages containing its principal figures, tables, and diagrams; an abstract-only
summary is not enough. Write `source-brief.md` with:

- the research question and why it matters;
- the method as a short causal or procedural chain;
- three to five result claims, preserving every reported number, unit, baseline,
  and comparison exactly;
- the conclusion and any limitation needed to avoid overstating the paper; and
- a visual-evidence inventory naming the strongest source figures or tables and
  what claim each one supports.

Record the PDF path and `source-brief.md` with the input evidence. Use the brief
as the factual boundary for all poster wording. Prefer a real, legible source
figure, table crop, or faithful code-native reconstruction when it carries a key
result. Generated artwork may establish atmosphere or explain a concept, but it
must not replace empirical evidence or introduce unreported quantities. When the
paper contains usable visual evidence, the final poster must include at least one
evidence-bearing visual tied to a live caption or result claim.

## Generate the imagery

Generated artwork is a first-class visual material, not a required full-canvas
layer. Use it wherever photographic, illustrative, material, atmospheric, or
subject-specific content carries the design. Live typography and HTML geometry
may instead form the primary visual system when their precision, repetition,
and spatial relationships are the composition.

Do not replace imagery the design genuinely needs with a generic gradient, flat
fill, or improvised CSS illustration. Equally, do not generate a backdrop merely
to prove that artwork was used.

Generated support does not need to dominate the page; compact visual assets are
worthwhile when they make a section easier to scan, compare, or remember.

Avoid model-authored SVG illustrations. Graphic content is either generated
raster artwork or it is typography and geometry.

Codex's bundled Node runtime includes Lucide; for common small icons, prefer a
coherent locally embedded Lucide subset over ad hoc CSS drawing, without adding
runtime external requests.

### Choose the reference mode

Treat reference handling as a four-value mode even when the host exposes no
formal setting:

- `auto` — the default. Resolve it to `art-directed` for every new poster,
  including an open brief and the one-shot fast path; the composition reference
  is a standard design step, not an optional enhancement that depends on the
  user describing a finished picture. Resolve it to `off` only when the user
  explicitly declines reference generation, or when a small revision to an
  existing poster does not change its composition. Resolve it to `reproduce`
  when the user supplied an image as the target or asked to match one closely. A
  loose style or mood reference does not imply reproduction.
- `off` — skip composition-reference generation.
- `art-directed` — generate one enhanced, non-shipping composition concept.
- `reproduce` — treat the supplied reference as a high-fidelity specification.

Respect an explicit user choice over `auto`. Whenever `art-directed` is active,
run the creative prompt enhancer below; it is not a separate switch.

When image generation is unavailable, resolve `auto` to `off` when live
typography, HTML geometry, local icons, and user-provided assets can satisfy the
request. If the requested result fundamentally requires generated photography,
illustration, or cutouts, report the missing capability instead of silently
substituting a materially weaker design. A supplied target can still use
`reproduce` without image generation when it can be rebuilt from live elements.

### Create an art-directed composition reference

Generate **one reference composition** before planning anything, and read the
layout off it. Pass the request through a
**creative prompt-enhancement step** and ask the image model for one opinionated,
fully art-directed finished-poster concept rather than a literal transcription.
Lock every user-specified fact, string, subject, required placement, palette
requirement, and exclusion. Freely intensify only the composition, hierarchy,
crop, scale relationships, photographic direction, lighting, materiality,
typography treatment, grid behaviour, and spatial rhythm. This reference-only
step deliberately has more creative freedom than shipping-asset generation,
and it is the only step where the image model is allowed to render text.

Creative expansion changes the design language, not the requested content. Do
not invent facts, dates, locations, prices, brand names, slogans, people,
products, narrative subjects, or extra scene objects. Preserve minimalism when
requested, but express it through tension, scale, atmosphere, material depth,
and precise hierarchy rather than by making the frame merely empty.

Three boundaries make this safe. Breaking any of them wrecks the rest of the run:

- **The reference never becomes artwork.** Save it under `reference/`, never
  `assets/`, and never crop it into a backdrop — it has generated lettering all
  over it.
- **The reference's pixels never ship.** Every character is re-set in HTML. A
  generated glyph cannot be edited or re-flowed, and generated Chinese in
  particular is often subtly wrong. Its *wording*, though, is fair game: if the
  reference invented a line that fits, adopt it as live HTML text and name the
  added lines in the handoff. Facts are the exception. Prices, dates, locations
  and brand names still come from the user; a plausible date the image model
  made up is still a false date.
- **Choose the shipping asset architecture after reading the reference.** The
  reference determines composition, hierarchy, visual regions, and depth
  relationships; it does not require a backdrop. Generate a clean full-bleed
  backdrop when the integrated design decision selects a continuous scene.
  Otherwise generate the selected slots, cutouts, or fragments, or rebuild the
  graphic relationships as live typography and geometry when the reference's
  visual force is fundamentally graphic and modular.

Read off the reference: major visual regions and their proportions, band
positions when they are actually present, visual weight, palette relationships,
text-bearing regions, depth and overlap relationships, and any supporting
visuals, large or small, that materially contribute to meaning, comparison, or
recall. Write these observations into the integrated design plan below. Before
calling the image model, save the exact enhanced prompt in
`reference/composition-prompt.md`; after the result is imported as
`reference/composition-reference.png`, record both under `P02_reference`. These
are evidence for the Replay, not extra design prose.

### High-fidelity reproduction

When the user asks for the reference to be reproduced closely — "make it look
like this" — or supplied the image explicitly as the target, treat it as a
specification rather than a sketch. Work element by element: match positions, proportions,
decorative marks and where each colour sits, and adopt its wording wholesale
as live HTML text.

Two things do not change under this mode. Text is still re-set in HTML, never
lifted as pixels. And facts still come from the user.

Say in the handoff that you were reproducing a reference, and name whatever you
could not reproduce — a hand-drawn contour edge, a texture, a script face that
is not installed.

### Choose the asset architecture before prompting

Before finalizing the asset plan, identify every visual component that
materially contributes to subject, hierarchy, atmosphere, comparison, recall,
semantic distinction, or fidelity to the reference. Let the composition
determine the asset count. Generate all main and supporting assets needed for
the finished poster, and do not consolidate distinct visual roles merely to
reduce generation work.

Use the image model proactively for supporting visual assets when they would
strengthen communication; do not reserve generated imagery only for the main
visual or explicitly requested detail shots.

A generated raster is not the only way to preserve a strong visual reference.
For example, a dense Memphis-style exhibition poster may be strongest as a live
modular composition: monumental typography, saturated colour fields, black
keylines, checker and halftone patterns, label rails, inline pictograms, and
independently placed icon panels. Rebuild those relationships as live HTML/CSS
geometry and inline SVG when flattening them into a background would weaken
their structure, precision, or editability. This is a complete visual system
derived from the same mandatory art-directed reference, not a fallback from
generated imagery.

Choose by visual topology, not by habit. No topology is the default:

- **Slot matrix** — one image per bounded card, product cell, specimen, or
  timeline node; HTML owns the grid and captions.
- **Code-native modular field** — live typography, colour blocks, rules,
  patterns, icon cells, diagrams, and inline geometry form the primary visual
  system. Use this when the reference's force comes from graphic composition,
  precision, repetition, and modular rhythm rather than photographic material.
- **Continuous scene** — one zoned full-bleed backdrop plus HTML typography.
  Use this when the meaningful imagery depends on shared lighting, perspective,
  atmosphere, or physical continuity.
- **Cutout stack** — independent transparent subjects arranged across explicit
  back, middle, text, and foreground layers.
- **Layered collage** — a base field plus a small set of independently placed
  photo fragments, paper pieces, textures, stickers, or cutouts.

Keep elements together when their shared lighting, perspective, material, or
physical interaction makes them one visually continuous scene. Separate or
rebuild them independently when their position, crop, replacement, repetition,
semantic role, or overlap is part of the design. Do not split elements that
share continuous light and perspective merely to make the file count larger;
their seams will show.

Visuals assigned to distinct meanings must remain perceptually and semantically
distinct. Reuse is acceptable only when each instance clearly communicates its
own intended meaning; unintended repetition is a defect.

For a slot matrix, cutout stack, or layered collage, read
[Asset architecture](references/asset-architecture.md). When two or more
shipping assets are needed, create `asset-plan.json` before generating anything;
record each asset's form, target rectangle, layer order, and dependencies.

### Prompt the shipping assets

Before writing shipping prompts, read [Imagery](references/imagery.md) and
follow it exactly. The art-directed composition reference may render poster
text; shipping assets may not.

Use one call per distinct asset. After every shipping prompt and destination
filename is frozen, dispatch up to ten independent generations concurrently in
one batch; do not split a run of ten or fewer assets into smaller waves. For
more than ten, use consecutive batches of ten. Parallelism applies only to
assets without dependencies on another returned image; corrections based on a
returned image remain sequential. Orchestrate the batch with all-settled
semantics rather than fail-fast semantics so one rejected call cannot cancel or
hide the successful results.

Let the whole batch settle, preserve every successful result, and retry only the
failed calls immediately rather than rerunning or delaying the successful ones.
Retry a transient failure once with the same prompt. For a safety refusal or an
obvious prompt-specific failure, revise only that asset's prompt and retry it
once; stop automatic retries after that second attempt and continue with the
successful assets while choosing a safe substitute or reporting the missing
slot. Do not ask for several unrelated cutouts in one sheet: one call returns
one raster, not several independently editable transparent files.

Import all successful results in one post-batch pass with
`scripts/import-asset.sh GENERATED_PATH assets/NAME.png`. Check dimensions,
unwanted lettering, and obvious slot mismatch together in that same pass, then
record the prompt file and selected asset results once. Do not pause for
per-image narration, rewrite already-frozen planning files between successful
results, or introduce a second selection phase when the outputs satisfy their
slot prompts. For ten or fewer independent assets, post-generation handling
should add only local import and one consolidated inspection, not another
multi-minute reasoning stage.

## Start new posters immediately

Before setup, if the intended target directory already exists or the workspace
contains an apparent same-title poster project, ask whether to continue that
project or create a new one. Do not treat matching titles, copy, assets, or
timestamps as authorization to modify user-owned files. Make no writes to the
existing project until the user answers; skip this confirmation only when the
user explicitly identified that existing project as the target. This collision
check happens before and overrides the immediate-setup rule below.

For a new poster in an empty or projectless workspace, make setup the first task
action. From an existing parent directory, run this skill's
`scripts/init-poster.sh TARGET`; do not set the command's working directory to a
target that does not exist yet. Do not run a second initializer.

It copies the starter plus project-local runtime scripts and reports whether a
renderer is available. Change into the target before running the remaining
commands. **Complete this before asking any discovery questions**, then open the starter's
`index.html` in the browser so the user sees the placeholder layout while you
work. Begin the trace in the same breath:

```bash
scripts/trace.sh init "<one line about this poster>"
```

Immediately write the active user-authored brief to `brief.md`, verbatim and in
order, including user-supplied attachment paths. Do not copy ambient UI state,
system instructions, or hidden context into it. Record it with
`scripts/trace.sh artifact brief.md P01_input`. This is the Replay's source of
truth; the trace label is not a substitute for the original request.

If no renderer is available, do not abort: the HTML is still deliverable, it just
produces no PNG. Say so once in the final handoff rather than repeatedly.

In a delegated, background, or invisible thread, initialize normally but do not
open a browser purely for preview. **Reading the render is not preview and is
never skipped.**

## One-shot build

After setup and any necessary clarification, design and produce the poster in one
focused pass. Trace only the stable artifacts named below.

1. Read `index.html`, `poster.json`, and the contract in `README.md`. Read other
   files only when the implementation needs them. Avoid broad scans and
   speculative research.
2. **Fix the canvas.** Infer the size from the intended use, and tell the user
   which one you chose and why in your first update. Write it into `poster.json`;
   the root element's `width`/`height` must equal its `data-canvas-*` values.
   `scripts/trace.sh decision canvas "<W>x<H>" "<why>" P09_canvas`
3. **Complete the reference stage before planning the design or shipping
   assets.** Resolve the reference mode. Under `art-directed`, save the enhanced
   prompt, generate and import the composition reference, read it, and record its
   prompt and image under `P02_reference`. Under `reproduce`, inspect the supplied
   target as the specification. Under `off`, continue without creating reference
   artifacts.
4. **Make one integrated design decision after the reference settles.** In one
   pass decide the final live HTML wording, information hierarchy, asset
   topology, text and image regions, layer order, palette roles, font stacks,
   and asset or region geometry. Keep every user-supplied string verbatim; name
   any non-factual wording adopted from the reference in the handoff. Write the
   decision once in `design-plan.md`. When two or more shipping assets are
   required, also write the minimal machine-readable `asset-plan.json` from
   that same decision. Record both together under `P11_asset_plan`.
   When typography is a primary visual material or the editor needs stronger
   alternatives, read [Font system](references/font-system.md), choose fonts by
   role, and use the self-hosted kit rather than defaulting to the same system
   sans/serif pair.
5. **Generate the artwork** per the batching, retry, import, and inspection
   policy above, into `assets/`. Record the completed batch once. In multi-asset
   runs, every
   `asset-plan.json` entry's `prompt` value must exactly match one `##` heading
   in `prompts.md`, and the imported filename stem should match the asset `id`:
   `scripts/trace.sh artifact prompts.md P12_generate_imagery`.
6. **Make one complete layout patch.** One file, CSS inline, zero external
   requests, absolute positioning inside the canvas, fixed px for every layout
   dimension. Declare the palette and font stacks on `:root` and reference them
   throughout. Do not write comments.
   When the plan selects a bundled font, run `scripts/font-kit.mjs add <id>
   index.html` after the HTML exists, then assign its generated
   `--font-kit-<id>` variable to the intended type roles before checking fonts.
   For selected Lucide icons, resolve them from the bundled runtime at build
   time and inline only their SVG markup in the poster HTML; keep their size,
   stroke width, and color treatment consistent, and add no runtime import.
7. **Check the final HTML font stacks once** with
   `scripts/check-fonts.sh index.html`. A missing family raises no error in the
   browser, and a family marked `latin only` must not set CJK text. Fix any
   failure before rendering.
8. **Clear the scaffolding**, see below.
9. **Check the deterministic contract**:
   `scripts/check-poster.sh index.html`. Fix every failure before opening Chrome.
10. **Run the editable-layout preflight before the first render**:
    `scripts/trace.sh run P14_contract -- node <poster-building-skill>/scripts/check-contract.mjs index.html`.
    It
    checks fixed geometry, layer and group structure, viewport stability, font
    loading, and whether live-text hit areas are blocked by another layer. Fix
    every failure now; this is the cheap point to change structure.
11. **Render**: `scripts/trace.sh run P15_render -- scripts/render-poster.sh
   index.html out/poster.png`. It reads the PNG's real pixel dimensions back and
   compares them with `poster.json`; a mismatch is an error.
12. **Review, fix, and optimize the render** through the single review loop below.
    Keep every real pass in `render-review.md`; do not create a second review
    record for optimization. After the final render, record the consolidated
    review once under `P16_read_render`, and record the current `index.html` and
    `out/poster.png` under `P15_html` so Replay cannot select an obsolete version.
13. **Wire the bundled editor runtime** without changing `index.html`:
    `node scripts/wire-editor.mjs index.html`. Confirm that `editor.html`,
    `layer-editor.css`, and `layer-editor.js` exist, then
    `scripts/trace.sh artifact editor.html P17_editor`.
14. **Verify the editor and exploded view** with
    `scripts/trace.sh run P17_verify -- node <poster-building-skill>/scripts/verify.mjs index.html`.
    The same browser
    run writes the verified standalone result to `layers.html`; do not launch a
    second generation pass. It must pass the
    geometry-plus-pixel zero-drift, edit/export round-trip, overview/background
    component extraction, one-level gallery spread, theme, scan, replay, collapse, and
    standalone-render checks. After it passes, record
    `scripts/trace.sh artifact layers.html P17_layers`. Read
    [Editor and exploded views](references/editor-runtime.md) for setup and
    commands.
15. **Generate the Agent Design Replay** only after the poster and editing
    contract pass: `node scripts/build-replay.mjs .`, then
    `node scripts/verify-replay.mjs replay/index.html`. Record the `replay/`
    directory under `P18_replay`, then `scripts/trace.sh finish ok`. For an
    older project without those project-local scripts, run this skill's bundled
    `scripts/build-replay.mjs PROJECT` and `scripts/verify-replay.mjs
    PROJECT/replay/index.html` instead. Open the generated Replay once and
    confirm that the seven nodes, Prompt/result pairs, render, Review, and layer
    preview load. The fixed
    template, not the agent, designs this page. Read
    [Agent design replay](references/replay-contract.md) only when recording or
    diagnosing its evidence contract.

## Record the creative path without constraining it

The Replay is a post-build view of real artifacts. It does not add a visual
selection gate, require multiple directions, or change how the poster is
designed. Preserve the exact user request, enhanced reference prompt, plan,
shipping prompts, imported results, HTML, render review, and verified layer
output while working; the builder groups them into seven story stages.

Do not ask the model to redesign the Replay, summarize the run from memory, add
generic “why this was done” commentary, or reconstruct missing prompts. The
viewer displays recorded Agent content and marks absent evidence as missing.
Optional alternatives and selection branches appear only when the run actually
contains them.

## Capability path

### Project setup

- For a new poster use the flow in **Start new posters immediately** and keep the
  starter's canvas, runtime, and validation contract. Its preview scaffolding is
  not a composition, asset-topology, image-coverage, or text-placement guide.
- For an existing poster, preserve its file organisation, `poster.json`, and
  asset paths. A copy change is only a copy change; do not re-flow the layout
  along the way.
- Keep poster code within the project directory.

### Shape the poster

- Hierarchy is the whole job. A viewer takes a poster in three passes: hook,
  then claim, then detail. Build that staircase with size, weight, colour, and
  white space, and make the steps genuinely different. Two elements of similar
  visual weight fight each other and both lose.
- White space is structure, not what is left over.
- Build a controlled palette with explicit roles for the field, text, accents,
  and semantic states. Add colours when the brand, reference, imagery, or
  information encoding requires them; no colour exists merely to fill space.
- Commit to one direction — editorial, luxury, brutalist, playful, technical —
  and let it drive every decision.
- Give every typeface a clear role and verify that it covers the script it sets.
  Use as many families as the composition genuinely needs while preserving a
  coherent hierarchy. Every step of the size ramp must be clearly different
  from the last.
- Distinguish the active type system from the editor palette. A poster normally
  uses two or three families, while three to five verified `:root` font roles
  may be exposed as meaningful alternatives. For a poster, cover, flyer, or
  campaign, do not ship only one generic sans stack unless the brief or brand
  deliberately requires it.
- For vertical CJK type, set `white-space: nowrap` and centre it with flex.
  `text-align` controls the vertical axis under `writing-mode`, so a fixed-width
  box leaves the text against its right edge.
- Where text sits over artwork, guarantee contrast explicitly: a solid panel, a
  scrim, or a directional gradient sized to the text block. Do not count on the
  image being dark enough exactly where you need it.
- Do not default to a coloured or black text box: first use an existing calm region or a local scrim, and add a panel only when its material, edges, palette, and overlap make it an intentional part of the composition rather than a generic card.
- When unsure about the layout, read [Layout and typography](references/layout-typography.md).
- When typography is prominent or the available choices feel generic, read
  [Font system](references/font-system.md) and use its self-hosted font kit.

### Build the default editing contract

Every poster ships with the bundled editor runtime for human
micro-adjustments and presentation. It can drag layers; resize width, height, or
both with side and corner handles; edit text; change font size or a declared
font family; delete and undo; save a local draft; scan and spread layers into an
exploded view; and download clean edited or exploded HTML. A manually resized
text width remains fixed during later text or font-size edits so the user's
intended wrapping is preserved. It is not a second design application.

Mark each independently movable semantic unit with a unique `data-layer-id`;
keep full-bleed backdrops, textures, scrims, fixed frames, and
`data-explode-group` wrappers unmarked. Use `hf-slot` for independently editable
styled-text leaves, and use a non-nested `data-explode-group` only when it
contains at least two meaningful leaf layers; never nest layer IDs or explode
groups. Declare selectable font stacks on `:root` with a generic fallback.
Keep the prebuilt editor runtime unchanged, generate `editor.html` only with
`node scripts/wire-editor.mjs index.html`, render and validate `index.html`, and
run the bundled browser verification before delivery.

### Deliver the standalone layer breakdown

Every poster includes `layers.html` in addition to the live breakdown in
`editor.html`. The bundled `scripts/verify.mjs` generates and verifies it in one
browser run. Groups remain whole modules by default; when fewer than five
primary content components would be visible, the same one-level gallery also
adds the grouped text leaves as companion tiles so the breakdown does not feel
empty. Do not hand-edit it, wire it back into the editor, or substitute it for
the poster render. Read
[Editor and exploded views](references/editor-runtime.md) before diagnosing a
failure.

### Clear the scaffolding before delivery

Apply the starter cleanup contract in `README.md` and record the sweep with
`scripts/trace.sh artifact cleanup-checklist.json P14_cleanup`. Preserve the
placeholder only when the user explicitly asked to work on the starter itself.

### Add only what this poster needs

- Before prompting generated artwork, and again when artwork comes back wrong,
  read [Imagery](references/imagery.md).
- When the design calls for product matrices, collage fragments, multiple
  cutouts, or foreground/background occlusion, read
  [Asset architecture](references/asset-architecture.md).
- For print, pass `--dpi 300`; the scale factor is derived at 96 px/inch. Only
  meaningful for a canvas sized in print dimensions. The renderer produces PNG
  only; there is no PDF path.
- Add no poster-specific interactivity, media queries, or CDN.
  The bundled default editor shell is the only interaction layer.

## Read the render

**Read the rendered image yourself. A poster you have not looked at is not
finished.**

When a visual reference exists, inspect it beside the current render before
deciding to finalize. Compare the focal subject's scale and position, headline
placement, major information regions, whitespace distribution, alignment,
required supporting details, reading order, and overall visual density. Name
only material differences that can be pointed to in the pixels.

During visual review, check for missing meaningful visual support, unintended
repetition, and mismatches between visuals and their associated content. Treat
them as defects when they weaken comprehension, hierarchy, or fidelity to the
request or reference.

When the reference includes typography, reject a result that looks more
templated, crowded, or hierarchically flat; rework the type before finalizing.

The reference is a benchmark for composition, hierarchy, completeness, and
quality, not automatically a pixel-perfect target. A difference is acceptable
when it deliberately adapts the design to live editable typography or
independently movable assets, or when the current solution is visibly as strong
as or stronger than the reference while preserving the request's intent. Do not
accept an element merely because it remains technically inside the canvas: it is
still defective when it sits visibly too close to a frame, rule, image edge, or
neighboring object. Do not
excuse a weaker focal subject, enlarged dead space, missing structure, reduced
density, poorer contrast, or lost detail as artistic variation unless the
change clearly improves the whole poster.

No script can do this step. The renderer proves the dimensions are right; it
cannot prove that text is not sitting on top of text, or that the artwork
brought its own placeholder lettering — and those two are the main reasons a
poster is scrapped.

Work down the list, and only count what you can point at. Do not evaluate taste:

- **Read every piece of text on the image out loud, line by line.** Anything you
  cannot read is a defect, however correct it looks in the markup
- Any text clipped, cut off by an edge, covered by another layer, or obscured
- Any placeholder copy: LOGO, TITLE, EVENT DETAILS, SUBTITLE, Lorem ipsum, or a
  lone brand-shaped word. This almost always came from generated artwork rather
  than from you
- Any two elements overlapping badly enough that one is unreadable
- For text intended to sit in a panel, ribbon, card, or dark field, compare its visible bounds with that carrier at pixel level; any text or backing that spills outside, misaligns with, or visibly floats above the carrier is a defect even when fully legible.
- Contrast wherever text sits over artwork. If it is short, add a solid panel, a
  scrim, or a directional gradient

For every actual render-review cycle, append one numbered pass to
`render-review.md` with its concrete findings, the changes applied, and the
result confirmed by the next render. A clean render records `none` for findings
and changes and `pass` for the result. Fix, re-render, and read again until no
defect remains. A taste preference is not a defect — do not invent one so you
have something to say.

After defects are resolved, perform exactly one optimization assessment against
the reference and request. Compare visual-asset count, semantic variety,
icon-to-copy pairing, and regions that changed from image-supported to text-only.
If one clear opportunity would materially improve scanning, recall, or fidelity,
apply only the highest-impact enhancement, update the asset plan and prompts when
needed, rerender, and append the real pass. If none exists, write `Optimization:
none` in the current pass and do not rerender. Record the consolidated file once
after the final render:
`scripts/trace.sh artifact render-review.md P16_read_render`.

If the same problem survives two fixes, your diagnosis is wrong. Stop, look at
the image again, and change your assumption rather than your wording.

## Optional PPTX handoff

The mouse-editable HTML is built in and is not an optional integration. Finish
and deliver the core design before discussing PowerPoint. When the separate
`html-to-pptx` skill is available, tell the user once that an editable PPTX can
also be exported. Do not generate it unless the user asks. After they ask, use
`html-to-pptx` with `index.html` or an editor-downloaded `*.edited.html` beside
its assets; never pass `editor.html`. PPTX availability must not delay or weaken
the HTML, editor, PNG, layer breakdown, or Replay delivery.

## Deliver

Use these stable English labels in the user-facing handoff, regardless of the
language used inside the design:

- **Final Design** — `out/poster.png`
- **Editable Source** — `index.html`
- **Visual Editor** — `editor.html`
- **Layer Breakdown** — `layers.html`
- **Agent Design Replay** — `replay/index.html`

Give the location of each available output, the canvas size and the font
families used, and the text
you read line by line off the render. Tell the
user that `editor.html` supports mouse dragging, eight-handle width/height
resizing, double-click text editing, and scan/explode/collapse views.
Treat Replay as a local evidence artifact by default and warn before sharing it,
because it may contain the original brief, prompts, attachment paths, and design
decisions.
State anything still wrong and exactly how it falls short; do not describe it
as finished.

When you cannot finish, name the obstacle — which fact is missing, which two
requirements contradict each other, how the amount of content and the canvas size
fail to fit — and say what you need. Do not disguise a design problem as missing
information.

Keep commands, exit codes, renderer names, and other internals out of the handoff
unless the user asks.
