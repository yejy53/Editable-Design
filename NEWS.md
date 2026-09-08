# Editable Visual Design — News

A concise, date-based record of user-visible project updates. New entries are added at the top.

[← Back to README](./README.md)

## 2026-09-08

- Added direct links to the [arXiv abstract](https://arxiv.org/abs/2609.04034), [paper PDF](https://arxiv.org/pdf/2609.04034), and [Hugging Face paper page](https://huggingface.co/papers/2609.04034).
- Added this News page so ongoing changes can be followed without expanding the main README into a full changelog.

## 2026-09-04

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
