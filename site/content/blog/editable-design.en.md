---
title: Editable Visual Design
subtitle: Coding-Agent-Driven Creation of Editable Visual Artifacts
summary: The question we care about is narrow and practical: when an AI hands over a design, should you receive a picture that can only be regenerated, or a document you can keep editing?
date: 2026-08-28
kicker: Research
variant: x3
ctaLabel: Gallery
ctaHref: https://yejy53.github.io/Editable-Design/
github: https://github.com/yejy53/Editable-Design
tags: editable design, coding agent, visual prior
---

<!-- Asset list (working note, never rendered)
Files live in site/public/blog/editable-design/ and are referenced as
/blog/editable-design/<file>. Swapping an asset means overwriting the file
under the same name; only the `aspect` of a case block needs touching when the
new file has a different ratio. Rebuild everything with ./tools/build_assets.sh.

The English post uses promo-en.mp4 (silent, English captions, 136.3s cut).
The Chinese post uses promo-zh.mp4 (Chinese voice-over and BGM, 123.0s cut).
Every other asset is shared with the Chinese post.
-->

In real design and front-end work, **"handing over an image" has never been the same as "finishing the design."**

However striking the light and texture of a raster image are, if it cannot be separated into layers, if its text cannot be rewritten, and if its elements cannot be adjusted independently, then in a serious production pipeline it remains a reference — a visual half-product. A product manager wants one line of copy changed; marketing wants a different set of dates; a designer wants the hero element moved twenty pixels to the left. In a conventional text-to-image workflow, each of those small edits means starting over and rolling the dice again, at high cost and with no guarantee.

So we changed the question. Instead of asking whether AI can draw a good-looking poster, we ask whether **AI can deliver a document that can still be edited**. That question is what **Editable Visual Design** is built around: a Coding Agent acts as the design architect, and visual generation moves from a one-shot bitmap to a structured code deliverable with decoupled layers, editable text, and a real quality gate.

The walkthrough below runs the whole path, from the initial brief and the concept image through layer decomposition to native HTML/CSS construction and interactive editing:

```case
mode: gallery
aspect: 16/9
item: | /blog/editable-design/promo-en.mp4
```

## Why editability is the real threshold

A production-grade design asset has to carry two properties at once: **visual expressiveness** and **deterministic editability**. Text should be clean, selectable characters; the subject and illustrations should be independent, transparent assets; layout and geometric decoration should follow a strict grid.

Putting the two kinds of artifact side by side makes the difference concrete. On the left is what a diffusion model produces directly from the brief: the mood and the texture are there, but the text is painted rather than typeset and the layers are fused, so changing a single word means regenerating the whole frame. On the right is the artifact Editable Visual Design produces from the same brief: in the browser it is a DOM tree, and the headline, body copy, detail shots, and background are each their own layer.

```case
mode: compare
aspect: 9/16
item: Diffusion output · one bitmap | /blog/editable-design/compare-diffusion.jpg
item: Editable Visual Design · HTML structure | /blog/editable-design/coded-artifact.jpg
caption: Two artifacts from the same Nordic furniture brief. On the right, every piece of text is a real character and every asset can be selected, moved, and replaced on its own.
```

> Visual quality can be approximated by rolling the dice again. Maintainability cannot. Whether a design can still be edited is what separates a picture from a deliverable.

## The "left brain" of code and the "right brain" of diffusion

Getting refined aesthetics and full editability at the same time runs into a familiar split-brain problem.

**"Left-brain" pure code generation.** The latest generation of large language models is fluent in HTML, CSS, and DOM-tree layout: the structure is tidy and naturally supports later edits. But code is essentially a one-dimensional symbol sequence, and these models lack a global sense of two-dimensional space. Asked to write layout code directly, they usually land on the highly templated trio of a big headline, rounded cards, and block shadows, and they struggle to cross from "syntactically correct" to "visually refined." Worse, complex assets — cinematic backgrounds, photorealistic illustration, natural texture — are extremely hard to hand-draw in code, so the result tends to lack visual tension.

**"Right-brain" diffusion generation.** Diffusion models compress centuries of human artistic prior and can produce composition, lighting, and atmosphere instantly. What they lack is rigorous structural logic: the raster images they generate come with distorted text and deeply entangled layers, which rules them out as engineering deliverables.

Inspired by the World Action Model (WAM), we did not pick a side. We combined the two into a **"creative brain plus visual simulator"** mechanism:

1. **A VLM is the creative brain**, coordinating requirement understanding, task planning, structured code writing, and the final visual review of the render.
2. **A generation model is the visual world simulator**, an external tool the brain can call at any time to turn an abstract idea into a concrete image, and to render clean, standalone local assets.

![Overview of the Editable Visual Design workflow](/blog/editable-design/workflow.jpg "Workflow overview: understanding and design planning → visual simulation → code–asset co-generation → editable design. The band along the bottom is the Design Replay that runs through all of it.")

Across the whole pipeline, the image model is called only where pixels are actually needed. *Understanding and design planning* turns the user prompt into an explicit plan over layout, color, typography, and assets. *Visual simulation* obtains a global concept sketch, whose layout, color, hierarchy, and density are fed back to refine that plan before any code is written. *Code–asset co-generation* then runs two tracks in parallel: an asset generator produces clean, standalone backgrounds, illustration elements, and iconography on demand, while a code builder assembles them with the real text into native HTML/CSS/SVG. *Editable design* delivers the result as a canvas whose layers stay independently selectable and can be exported to HTML/CSS/SVG, PPTX, PNG, or PDF.

## Imagine first, then act

The agent follows an "imagine first, then act" loop. Before writing code it calls the simulator for a concept sketch that fixes composition, lighting, and color; it then decomposes the assets it needs, generates clean standalone pieces (a text-free background, an isolated subject), rebuilds the layout in native HTML/CSS/SVG, and repairs the result over a few rounds of looking at the render.

It matters that we never ask the agent to reproduce the visual reference one-to-one. The sketch works as an **aesthetic prior**: how full the frame should be, where the hero visual sits, whether the palette runs warm or cool, how much air to leave.

```case
mode: gallery
aspect: 9/16
item: | /blog/editable-design/prior-concept.jpg
item: | /blog/editable-design/coded-artifact.jpg
caption: Left: the concept reference from the image model, which fixes composition, palette, and information density. Right: the artifact the agent rebuilt in code from that prior — all text is real characters, and the detail shots and background are independent assets.
```

> Aesthetics is the kind of prior that is very hard to quantify in one-dimensional text and very easy to make concrete as an image. Letting the agent *see* a possible direction before it writes the real content and the editable structure is far more reliable than asking it to write blind.

Once the code is built, the artifact is layered by construction. Exploding the same artifact inside the editor shows what it is made of:

![Exploded layer view of an editable artifact](/blog/editable-design/layers-exploded.jpg "The same artifact, exploded: headline, body copy, detail shots, background, and decoration are each independent, and each can be selected, moved, reordered, and exported on its own.")

A first pass of generated code inevitably carries flaws — overflowing styles, overlapping elements, text occluded by imagery — so delivery is gated by a double check with self-healing. The system first loads the page in a headless browser and runs deterministic layout rules: elements out of bounds, external resources failing to load, malformed DOM. It then hands an actual rendered screenshot to a VLM reviewer, which compares the render against the design intent and judges visual balance, alignment precision, and text readability. When something is wrong, the agent writes a targeted local patch, and one or two rounds of reflection and repair are usually enough to bring the render up to standard.

## Delivering something you can keep editing

Today most multimodal creation ends at a **raster image**. Once that image ships, its text, layers, and layout are effectively frozen. Artifacts produced as visual code — **HTML, PPTX** — are editable by nature: the text is accurate, the layers are addressable, and what the user receives is not a picture to be remade wholesale but a **document to keep working on**.

The clips below make that concrete: each one is elements being dragged, text being rewritten, and assets being swapped, directly in the browser.

```case
mode: gallery
aspect: 7/6
item: | /blog/editable-design/editable-nordic-chair.mp4
item: | /blog/editable-design/editable-poster-edit.mp4
item: | /blog/editable-design/editable-dragon-year.mp4
item: | /blog/editable-design/editable-cobalt-prayer.mp4
item: | /blog/editable-design/editable-ai-recruiting.mp4
item: | /blog/editable-design/editable-shanyou-tea.mp4
caption: Six artifacts from different categories inside the editable canvas: double-click to edit text, drag and scale assets, export layers individually.
```

The same workflow holds across very different information densities and visual registers. The figure below takes three briefs written in deliberately different styles — a paper-cut winter city atlas, a bright 3D summer music poster, and a flat grid-style Memphis tech expo poster — and shows each as the prompt, the final coded design, and the same artifact opened as an editable canvas:

![Prompt, coded design, and editable canvas for three briefs](/blog/editable-design/showcase-editable.jpg "From prompt to editable canvas. The right-hand panels carry the point: what is delivered is not a flattened picture but a set of independently addressable elements.")

When one image asset needs replacing, that is a single call to the image model for a local swap, not a regeneration of the whole piece. That is the most practical difference between structured delivery and rolling the dice again.

## Agent Design Replay: no more black box

Whether the route was text-to-image or end-to-end code generation, the process has largely been an uninterpretable black box: you send a prompt, you wait, and you cannot see the reasoning or intervene halfway.

**Agent Design Replay** records the agent's full path — requirement understanding, concept simulation, asset generation, code adjustment — and presents it with timestamps, grouped into three phases: understand and plan, generate and build, review and fix.

```case
mode: gallery
aspect: 16/9
item: | /blog/editable-design/replay-nordic-chair.mp4
caption: The interactive Design Replay view: every step carries a timestamp and its own output, with the current layer structure and render shown alongside.
```

Two real cases show how the trajectory follows the nature of the brief:

![Agent Design Replay for a red panda field guide](/blog/editable-design/replay-red-panda.jpg "An information-dense brief: standalone assets — a habitat hero plus face, paw, and tail details — composed against a 1600 × 2400 render contract with 120 editable layers in 13 groups, where the review pass caught and repaired real defects such as fast-fact rows overflowing their grid.")

![Agent Design Replay for a rainy-night Chongqing poster](/blog/editable-design/replay-chongqing.jpg "A visually driven brief: one full-bleed backdrop carries the composition, the contract is 1200 × 1600 with 6 layers in 1 group, and the review reads the typography line by line and passes with no changes.")

The same workflow and the same quality gate yield layer structures that follow the density of the brief. That process visibility helps build understanding and trust in human-in-the-loop collaboration, and it makes intervening midway possible for the first time.

## Discussion

### Revisiting "generation for understanding": nobody solves math in a dream

When unified multimodal models explored "generation for understanding," the attempts mostly targeted tasks with strong symbolic logic — drawing geometric auxiliary lines, reasoning through mazes — and the gains were often limited.

The reason may be that rigorous deductive reasoning is a poor fit for the implicit feedback of a generative model. A vivid analogy: **people can hardly solve a rigorous math problem inside a dream, yet dreams are exactly where visual inspiration, imagery, and ideas come from.** Diffusion generation is a kind of visual dreaming; asking it to participate in precise computation invites error. Aesthetics, on the other hand, is precisely the prior that resists one-dimensional text and yields easily to an image.

Placing the generation model up front as a visual simulator, so the agent perceives the overall effect before writing code, uses generation to obtain high-dimensional aesthetic and compositional priors — which then feed naturally back into structured layout decisions in code.

### Where generation models actually fit: an external renderer for the decision brain

From GenClaw and Mind-Brush through to the work described here, a natural division of labor keeps showing up. The core strength of today's image models is fitting high-dimensional visual quality; they do not, by themselves, carry general logical reasoning or systematic planning.

Treating the generation model as an **external simulator and local asset renderer that the agent can call at any time** is therefore pragmatic and efficient. Requirement decomposition, task planning, code organization, and quality checking are led by a VLM with general reasoning ability, while the generation model turns abstract ideas into concrete visuals on demand. The combination keeps the expressiveness of the generation model and uses code to supply the structural control it lacks.

### From bitmap output to structured engineering delivery

In real design and commercial settings, a deliverable has to be maintainable and leave room for adjustment. Conventional text-to-image models produce rich visual quality, but deeply entangled pixels and error-prone text make later fine-tuning difficult.

Editable Visual Design organizes the page with native HTML/CSS and decoupled assets, so text, background, and graphic layers stay relatively independent and can be selected, modified, and exported afterwards. It marks a shift from one-shot bitmap generation toward **engineering artifacts** that carry both visual expressiveness and deterministic maintainability.

### Agent Design Replay: from visible process to human-like interaction

Agent Design Replay improves the transparency and traceability of the design decision chain. Beyond that, it offers a reference for more natural forms of design interaction in the future — an AI operating a mouse through a GUI to lay out and draw directly on a canvas, for instance. When both the artifact and the process are open, a human and an agent can finally collaborate on the same document.

## Closing

What Editable Visual Design explores is a complete workflow in which AI conceives, plans, and delivers the way a human designer does: **sensing aesthetics through intuition, building order through code, and delivering value through engineering.**

The Gallery collects seventeen prompts across five visual-design categories, each with its final rendering, an editable demonstration, and an Agent Design Replay. The capability is packaged as the `poster-building` skill for hosts such as Codex and Claude Code; an installable skill package and a reproducible starter project are being prepared for public release.
