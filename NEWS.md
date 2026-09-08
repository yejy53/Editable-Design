# Editable Visual Design — News

A concise, date-based record of user-visible project updates. New entries are added at the top.

[← Back to README](./README.md)

## 2026-09-08

- 🔬 **Paper Fig v2, developed with GPT-6:** turn method descriptions into paper workflow and architecture diagrams in the requested visual style, with editable PowerPoint output. [Install with Codex](./README.md#paper-fig).
- Added drawing-prompt guidance for the full-page composition, region proportions, labels, connections, and meaningful image assets. The Skill saves the prompt before generating the visual draft.
- Featured three Paper Fig results at the [top of the Gallery](./README.md#paper-figures): OmniManip, Compact3D, and ICEdit. These static images use full-resolution lossless WebP previews and link to the original PNGs, without loading additional videos.
- Credited [PaperGallery](https://github.com/LongHZ140516/PaperGallery) and the original papers for the reference cases. The examples illustrate generated results, not a comparative benchmark.
- Moved News and the new Skill entry ahead of Overview, and removed the previous “Attention Is All You Need” academic-poster example.
- Added direct links to the [arXiv abstract](https://arxiv.org/abs/2609.04034), [paper PDF](https://arxiv.org/pdf/2609.04034), and [Hugging Face paper page](https://huggingface.co/papers/2609.04034).
- Added this News page so ongoing changes can be followed without expanding the main README into a full changelog.

## 2026-09-04

- 📢 **Editable Design — Initial Release!** Editable posters, infographics, art posters, and marketing campaigns with real text, independent layers, and Agent Design Replay. [Read the paper](https://arxiv.org/abs/2609.04034).
- Added a ready-to-copy BibTeX citation for the Editable Visual Design technical report.

## 2026-09-03

- Added an Academic Posters category and the “Attention Is All You Need” Gallery example.
- Added an evidence-first workflow for turning research-paper PDFs into editable academic posters.
- Added AutoDesign to the project acknowledgements.

## 2026-09-01

- Made `html-to-pptx` self-initializing: its first conversion now discovers a compatible Python runtime, creates an isolated environment, installs its dependencies and Playwright Chromium, and continues the requested export automatically.
- Added a single `scripts/run.sh` entry point and retained the prepared environment for later conversions.

## 2026-08-31

- Added a self-hosted, versioned typography kit for richer poster, cover, campaign, and information-design typography.
- Generated projects now copy only the selected WOFF2 font files instead of carrying the full library.

## 2026-08-29

- Simplified the Codex installation and first-use instructions in the main README.

## 2026-08-28

- Published the open-source Editable Design toolkit and its two independent Codex Skills: `editable-design` and `html-to-pptx`.
- Added the public Gallery with final designs, editable demonstrations, original prompts, and Agent Design Replays.
- Added click-to-play HD overview and replay video pages to reduce GitHub README loading cost.
- Improved Replay initialization and synchronized the main creation path with the Layers animation.
- Added automatic recognition of clean HTML, Editable Design editor pages, and exploded-layer boards to `html-to-pptx`.
