# Editable Design

Editable Design is a Codex-first preview skill for fixed-canvas visual work: posters, marketing graphics, covers, menus, banners, and social cards. It produces a clean HTML design, rendered PNG, mouse-editable HTML, an animated layer breakdown, and an evidence-backed Design Replay.

## Requirements

- Codex with local filesystem access
- Node.js 22.12 or newer
- A Chromium-based browser
- Bash on macOS or Linux

Install the browser validation dependency once:

```bash
npm ci --prefix scripts
scripts/doctor.sh
```

Set `EDITABLE_DESIGN_BROWSER=/path/to/chromium` only when automatic browser discovery fails.

Editable PPTX is provided by the separate companion skill `html-to-pptx`. Editable Design never exports PPTX unless the user asks for it after the core design is complete.

## Capability fallback

Image generation is host-dependent. When it is unavailable, the skill uses live typography, HTML geometry, local icons, and user-provided assets when those can satisfy the request. It does not silently replace an intrinsically photographic or illustrative request with a materially weaker design.

Replay is a local evidence artifact and may contain the original brief, prompts, attachment paths, and design decisions. Review it before sharing.

This community project is provided under the [Apache License 2.0](LICENSE). It is not an official OpenAI project.
