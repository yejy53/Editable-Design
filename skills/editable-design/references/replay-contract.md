# Agent design replay contract

Read this only when recording, generating, or diagnosing a poster Replay.
The Replay is a deterministic view of the actual run, not a second design task.

## Seven story stages

Production may use more steps, but the viewer always groups evidence into:

1. Input — the user's original request and supplied attachments.
2. Reference — the exact enhanced art-direction prompt and its generated image.
3. Plan — composition notes, zones, asset topology, and slot geometry.
4. Assets — each shipping prompt paired with its imported result.
5. HTML — real source code and the rendered poster.
6. Review — concrete findings, changes, and rerender outcomes.
7. Layers — the verified editor or standalone exploded view and contract counts.

Canvas choice, font checks, cleanup, imports, and command logs remain in
`.trace`; they are metadata inside these stages rather than separate story nodes.

## Evidence files

- `brief.md` — the original user request verbatim. Include attachment paths, but
  do not copy ambient UI state, system instructions, or hidden context into it.
- `reference/composition-prompt.md` — the exact prompt sent to the image model
  for the non-shipping art-direction reference.
- `reference/composition-reference.png` — the generated reference image.
- `design-plan.md` — the single integrated decision for live wording,
  hierarchy, asset topology, regions, layer order, palette, typography, and
  geometry.
- `asset-plan.json` — asset IDs, target rectangles, topology, prompt IDs, and
  dependencies when more than one shipping asset is used.
- `prompts.md` — exact shipping prompts. Every `##` heading used by an asset
  must equal that asset's `prompt` value in `asset-plan.json`.
- `assets/*` — imported shipping results. Prefer an asset filename stem equal to
  its `id` in `asset-plan.json`.
- `index.html` and `out/poster.png` — source and current render.
- `render-review.md` — the agent's real visual review, not a retrospective
  marketing explanation.
- `editor.html` and `layers.html` — editable and standalone exploded results.

Record each file under its existing trace step as soon as it becomes stable.
Do not write generic sections such as “why this was done” or “what this node is
doing”. The viewer exposes the agent's actual prompt, plan, code, findings,
changes, and outputs.

## Review format

Use one section per real review pass when more than one pass occurs:

```markdown
# Render review

## Pass 01

### Findings
- Concrete visible defect.

### Changes
- Concrete edit applied to address it.

### Result
- What the rerender confirmed.

### Optimization
- The one highest-impact enhancement applied, or `none` when the approved
  render already preserves scanning, recall, and reference fidelity.
```

Do not invent a pass merely to make the Replay look active. A clean first render
may have one review section with no defects and `Optimization: none`. Keep all
real review and optimization activity in this one file, then record the
consolidated `render-review.md` once under `P16_read_render` after the final
render.

## Generation

After the poster, editor, and exploded behavior pass verification:

```bash
node scripts/build-replay.mjs .
node scripts/verify-replay.mjs replay/index.html
```

For a project created before the Replay runtime was added, call the equivalent
scripts from the installed `poster-building` skill and pass the project path.
Do not rerun the project initializer over an existing poster.

The builder emits `replay/index.html`, `data.js`, CSS, JS, and local icons. It
embeds text evidence in `data.js`, so opening the result over `file://` does not
depend on `fetch`. Media paths remain relative to the poster project.

The fixed viewer keeps three persistent phase controls visible: 理解与规划
(01—03), 生成与构建 (04—05), and 观察与修正 (06—07). Those controls live in
the scalable canvas world rather than in a fixed screen-space overlay, so fit
view cannot stack them over evidence nodes. Each phase card uses a 210 × 210px
world-space footprint with a 56px icon and a 19px label, so the controls remain
legible after fit-view scaling. A plain open finishes on the clean
overview with no stage detail expanded. An explicit `?stage=` query remains a
supported deep link, and closing a detail removes that query. Flow-arrow markers
use user-space sizing so their heads remain visually bounded when stroke widths
change.

The Design Plan, final rendered PNG, and editable layer animation share the same
right-column x-position. The generated reference is centered in the open space
between the Visual Reference and Design Plan stages. A single straight dashed
blue connector runs from stage 02, behind the centered reference, and into stage
03; no solid blue route loops above the image. The render lightbox loads the
original PNG directly and aspect-fits it within the available viewport; it must
show the full image without cropping or substituting a partial viewport capture.

The viewer has three motion states. On load it reconstructs the complete path
in 4.7 seconds: canvas settle, rapid node placement, ordered line drawing,
one phase pulse, final-output settle, and completion-light activation. The
detail panel stays fully hidden until this reconstruction completes. The
finished overview then uses no moving dashes; its first main pulse appears after
about 0.4 seconds and its first repair pulse after about 1.1 seconds, followed by
clearly visible energy packets on main paths every 1.8–3 seconds and repair paths
every 2.6–4 seconds, with at most two packets alive at once. Ambient packets
cross their paths in about 1.15 seconds. The playback control pauses ambient
motion and runs stronger
600–800ms causal pulses while synchronizing node focus, artifacts, and the
detail panel. Ambient motion pauses when the document is hidden or the canvas is
zoomed below 0.20 scale. `prefers-reduced-motion` disables all three motion
layers without hiding evidence.

The main-canvas Assets previews also use a quiet gallery cycle only in the
finished overview: each visible card brightens, rises 2–3px, gains a slightly
stronger shadow, and scales its image to 1.015 for about 700ms. After all visible
cards have been featured once, the gallery rests for a random 4–6 seconds. This
cycle pauses with ambient motion and never competes with formal playback.

The Assets detail begins with a compact visual overview of every recorded
shipping result before its Prompt/result accordions. The main canvas uses a
2540×1780 world: the Assets node shows only a short Prompt summary and balances
with the surrounding stage cards. Up to four shipping results appear beside it.
Exactly one result expands across the entire former 2×2 footprint and uses one
short dashed connector. Two to four results use the 2×2 matrix, with one
connector per visible result and no connector branches for empty slots. Every
result remains available in the detail overview.
Design Plan uses recorded rectangles when all slots provide valid geometry. If
the plan records semantic asset slots but no rectangles, the viewer lays those
real slots out as a compact matrix with their IDs and recorded roles; it never
stacks them into an apparently blank placeholder. If no slots were recorded at
all, it states that evidence is missing rather than inventing a composition.
The generated reference sits centered between the Visual Reference and Design
Plan stages at a slightly smaller scale, with their dashed connector visually
entering and leaving the image. The final render and layer output use large cards
in the right output column.
The 反馈修正 label sits on the green observation path, while the red return
path remains the visible repair loop. This keeps evidence readable without
placing an artifact between flow nodes or over their connectors.

When the layer output is `layers.html`, Replay embeds its live HTML animation,
not a GIF and not its `?motion=0` screenshot state. Do not load its iframe at
page startup: start it when the intro reaches the Layers output, and restart it
whenever formal playback reaches Layers or the user opens that stage. This keeps
the layer motion synchronized with the surrounding Replay instead of letting it
finish behind the 4.7-second intro. The lightbox reloads it on every open.

The stage detail panel is a wide, independently scrolling surface; wheel input
inside it never changes canvas zoom. Clicking the reference or final-render
artifact opens an image lightbox instead of stage details. Clicking the layer
artifact opens a large live-HTML lightbox and reloads it so its animation starts
from the beginning on every open.

The builder may derive ordering, time, canvas size, layer counts, and asset
pairings from recorded files. It must never reconstruct a missing prompt or
decision from memory. Missing evidence stays visibly missing.
